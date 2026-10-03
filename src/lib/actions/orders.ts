"use server";

import { bookCondition, requireBookWork } from "@/lib/catalogue/book-boundary";

import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { assertSql } from "@/lib/harmonization/store";
import {
  orders,
  orderStatusHistory,
  works,
  workStatusHistory,
  instances,
  editions,
} from "@/lib/db/schema";
import {
  eq,
  and,
  asc,
  desc,
  inArray,
  notInArray,
  count,
  sum,
  avg,
  gte,
  lte,
  isNotNull,
  ne,
  sql,
} from "drizzle-orm";
import { containsPattern } from "@/lib/utils/like";
import type { SQL } from "drizzle-orm";
import type {
  OrderStatus,
  AcquisitionMethod,
  CreateOrderInput,
  UpdateOrderInput,
} from "@/lib/constants/orders";
import {
  TERMINAL_STATUSES,
  IN_TRANSIT_STATUSES,
  BOOK_IN_HAND_STATUSES,
  UNSPENT_STATUSES,
  getValidTransitions,
} from "@/lib/constants/orders";
import { recordActivity } from "@/lib/activity/record";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import {
  createOrderSchema,
  orderStatusSchema,
  updateOrderSchema,
} from "@/lib/validations/orders";
import { parseId } from "@/lib/validations/helpers";
import { createWorkSchema } from "@/lib/validations/works";
import {
  bookAuthorFor,
  newAuthorQueries,
  planBookWork,
} from "@/lib/catalogue/book-store";
import { sortCurrencyTotals } from "@/lib/utils/money";
import { getAppSettings } from "@/lib/actions/settings";
import {
  nextCatalogueStatus,
  type CatalogueStatus,
} from "@/lib/utils/order-status-sync";

/**
 * Keep a work's catalogueStatus in line with ALL its orders (C1, H4), without
 * ever demoting a book that is owned: a copy that is not deaccessioned counts
 * as a book in hand. The rules live in nextCatalogueStatus().
 */
async function syncWorkCatalogueStatusFromAllOrders(
  workId: string,
  notes: string,
) {
  const allOrders = await db.query.orders.findMany({
    where: eq(orders.workId, workId),
    columns: { status: true },
  });

  const ownedCopies = await db
    .select({ id: instances.id })
    .from(instances)
    .innerJoin(editions, eq(editions.id, instances.editionId))
    .where(
      and(eq(editions.workId, workId), ne(instances.status, "deaccessioned")),
    )
    .limit(1);
  const hasBookInHand =
    ownedCopies.length > 0 ||
    allOrders.some((o) =>
      BOOK_IN_HAND_STATUSES.includes(o.status as OrderStatus),
    );
  const hasActiveOrder = allOrders.some(
    (o) => !(TERMINAL_STATUSES as string[]).includes(o.status),
  );

  const work = await db.query.works.findFirst({
    where: and(bookCondition, eq(works.id, workId)),
    columns: { catalogueStatus: true },
  });
  if (!work) return;
  const fromStatus = work.catalogueStatus;

  // Only needed when a work leaves on_order: the status it had before it was ordered
  let statusBeforeOrdering: CatalogueStatus | null = null;
  if (fromStatus === "on_order" && !hasBookInHand && !hasActiveOrder) {
    const lastOrdered = await db.query.workStatusHistory.findFirst({
      where: and(
        eq(workStatusHistory.workId, workId),
        eq(workStatusHistory.toStatus, "on_order"),
      ),
      orderBy: desc(workStatusHistory.changedAt),
      columns: { fromStatus: true },
    });
    statusBeforeOrdering = lastOrdered?.fromStatus ?? null;
  }

  const targetStatus = nextCatalogueStatus({
    current: fromStatus,
    hasBookInHand,
    hasActiveOrder,
    statusBeforeOrdering,
  });
  if (targetStatus === fromStatus) return;

  // The status and its history row are one write
  await atomic((d) => [
    d
      .update(works)
      .set({ catalogueStatus: targetStatus })
      .where(and(bookCondition, eq(works.id, workId))),
    d.insert(workStatusHistory).values({
      workId,
      fromStatus,
      toStatus: targetStatus,
      notes,
    }),
  ]);

  recordActivity("work", workId, "work.catalogue_status_changed", {
    oldValue: fromStatus,
    newValue: targetStatus,
  });

  invalidate(CACHE_TAGS.works);
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getOrder(id: string) {
  return db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      work: {
        columns: { id: true, title: true, slug: true },
        with: {
          workAuthors: {
            with: { author: { columns: { id: true, name: true } } },
            orderBy: (wa) => asc(wa.sortOrder),
            limit: 3,
          },
          media: {
            columns: {
              s3Key: true,
              thumbnailS3Key: true,
              type: true,
              isActive: true,
              cropX: true,
              cropY: true,
              cropZoom: true,
              brightness: true,
              contrast: true,
            },
          },
        },
      },
      edition: {
        columns: {
          id: true,
          title: true,
          publisher: true,
          publicationYear: true,
          coverS3Key: true,
          thumbnailS3Key: true,
        },
      },
      venue: {
        columns: {
          id: true,
          name: true,
          slug: true,
          type: true,
          website: true,
          thumbnailS3Key: true,
        },
      },
      originPlace: {
        columns: { id: true, name: true, fullName: true },
      },
      destinationLocation: {
        columns: { id: true, name: true, type: true },
      },
      destinationSubLocation: {
        columns: { id: true, name: true },
      },
      statusHistory: {
        orderBy: (sh) => asc(sh.changedAt),
      },
    },
  });
}

export async function getOrdersForWork(workId: string) {
  return db.query.orders.findMany({
    where: eq(orders.workId, workId),
    orderBy: desc(orders.orderDate),
    with: {
      venue: {
        columns: { id: true, name: true, slug: true, type: true },
      },
      statusHistory: {
        orderBy: (sh) => desc(sh.changedAt),
        limit: 1,
      },
    },
  });
}

export async function getActiveOrders(filters?: {
  acquisitionMethod?: AcquisitionMethod[];
  venueId?: string;
}) {
  const conditions: SQL[] = [
    notInArray(orders.status, TERMINAL_STATUSES as OrderStatus[]),
  ];

  if (filters?.acquisitionMethod?.length) {
    conditions.push(
      inArray(
        orders.acquisitionMethod,
        filters.acquisitionMethod as AcquisitionMethod[],
      ),
    );
  }

  if (filters?.venueId) {
    conditions.push(eq(orders.venueId, filters.venueId));
  }

  return db.query.orders.findMany({
    where: and(...conditions),
    orderBy: asc(orders.orderDate),
    with: {
      work: {
        columns: { id: true, title: true, slug: true },
        with: {
          workAuthors: {
            with: { author: { columns: { id: true, name: true } } },
            orderBy: (wa) => asc(wa.sortOrder),
            limit: 1,
          },
          media: {
            columns: {
              s3Key: true,
              thumbnailS3Key: true,
              type: true,
              isActive: true,
              cropX: true,
              cropY: true,
              cropZoom: true,
              brightness: true,
              contrast: true,
            },
          },
        },
      },
      venue: {
        columns: { id: true, name: true, slug: true, type: true },
      },
    },
  });
}

export async function getOrderTimeline(
  filters?: {
    acquisitionMethod?: AcquisitionMethod[];
    venueId?: string;
    fromDate?: string;
    toDate?: string;
  },
  pagination?: { limit?: number; offset?: number },
) {
  const { limit = 50, offset = 0 } = pagination ?? {};

  const conditions: SQL[] = [];

  if (filters?.acquisitionMethod?.length) {
    conditions.push(
      inArray(
        orders.acquisitionMethod,
        filters.acquisitionMethod as AcquisitionMethod[],
      ),
    );
  }

  if (filters?.venueId) {
    conditions.push(eq(orders.venueId, filters.venueId));
  }

  if (filters?.fromDate) {
    conditions.push(gte(orders.orderDate, filters.fromDate));
  }

  if (filters?.toDate) {
    conditions.push(lte(orders.orderDate, filters.toDate));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [results, countResult] = await Promise.all([
    db.query.orders.findMany({
      where,
      orderBy: [desc(orders.orderDate), desc(orders.id)],
      limit,
      offset,
      with: {
        work: {
          columns: { id: true, title: true, slug: true },
          with: {
            workAuthors: {
              with: { author: { columns: { id: true, name: true } } },
              orderBy: (wa) => asc(wa.sortOrder),
              limit: 1,
            },
            media: {
              columns: {
                s3Key: true,
                thumbnailS3Key: true,
                type: true,
                isActive: true,
                cropX: true,
                cropY: true,
                cropZoom: true,
                brightness: true,
                contrast: true,
              },
            },
          },
        },
        venue: {
          columns: { id: true, name: true, slug: true, type: true },
        },
      },
    }),
    db.select({ count: count() }).from(orders).where(where),
  ]);

  return { orders: results, total: countResult[0].count };
}

export async function getProvenanceStats(dateRange?: {
  from?: string;
  to?: string;
}) {
  const conditions: SQL[] = [];

  if (dateRange?.from) {
    conditions.push(gte(orders.orderDate, dateRange.from));
  }
  if (dateRange?.to) {
    conditions.push(lte(orders.orderDate, dateRange.to));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const today = new Date();
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(today.getDate() + 7);
  const todayStr = today.toISOString().split("T")[0];
  const sevenDaysStr = sevenDaysFromNow.toISOString().split("T")[0];

  const [
    totalStatsResult,
    spentByCurrencyResult,
    activeCountResult,
    inTransitCountResult,
    arrivingThisWeekResult,
  ] = await Promise.all([
    db
      .select({
        avgOrderCost: avg(orders.totalCost),
        orderCount: count(),
      })
      .from(orders)
      .where(where),

    // Amounts in different currencies cannot be added; total each one apart.
    db
      .select({ currency: orders.currency, total: sum(orders.totalCost) })
      .from(orders)
      .where(
        and(
          notInArray(orders.status, UNSPENT_STATUSES),
          isNotNull(orders.totalCost),
          where,
        ),
      )
      .groupBy(orders.currency),

    db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          notInArray(orders.status, TERMINAL_STATUSES as OrderStatus[]),
          where,
        ),
      ),

    db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          inArray(orders.status, IN_TRANSIT_STATUSES as OrderStatus[]),
          where,
        ),
      ),

    // M3: include outer date-range filter in arrivingThisWeek subquery
    db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          isNotNull(orders.estimatedDeliveryDate),
          gte(orders.estimatedDeliveryDate, todayStr),
          lte(orders.estimatedDeliveryDate, sevenDaysStr),
          notInArray(orders.status, TERMINAL_STATUSES as OrderStatus[]),
          where,
        ),
      ),
  ]);

  const { homeCurrency } = await getAppSettings();
  return {
    spentByCurrency: sortCurrencyTotals(
      spentByCurrencyResult.map((row) => ({
        currency: row.currency,
        total: row.total ?? "0",
      })),
      homeCurrency,
    ),
    avgOrderCost: totalStatsResult[0]?.avgOrderCost ?? "0",
    orderCount: totalStatsResult[0]?.orderCount ?? 0,
    activeOrders: activeCountResult[0]?.count ?? 0,
    inTransit: inTransitCountResult[0]?.count ?? 0,
    arrivingThisWeek: arrivingThisWeekResult[0]?.count ?? 0,
  };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

type OrderFields = Omit<CreateOrderInput, "workId">;

/** An order and its first history row, for one atomic batch. */
function newOrderQueries(
  d: typeof db,
  id: string,
  workId: string,
  validated: OrderFields,
  status: OrderStatus,
) {
  return [
    d
      .insert(orders)
      .values({
        id,
        workId,
        acquisitionTargetId: validated.acquisitionTargetId ?? null,
        editionId: validated.editionId ?? null,
        instanceId: validated.instanceId ?? null,
        venueId: validated.venueId ?? null,
        acquisitionMethod: validated.acquisitionMethod,
        status,
        orderDate: validated.orderDate,
        orderConfirmation: validated.orderConfirmation ?? null,
        orderUrl: validated.orderUrl ?? null,
        price: validated.price ?? null,
        shippingCost: validated.shippingCost ?? null,
        totalCost: validated.totalCost ?? null,
        currency: validated.currency ?? null,
        carrier: validated.carrier ?? null,
        trackingNumber: validated.trackingNumber ?? null,
        trackingUrl: validated.trackingUrl ?? null,
        shippedDate: validated.shippedDate ?? null,
        estimatedDeliveryDate: validated.estimatedDeliveryDate ?? null,
        actualDeliveryDate: validated.actualDeliveryDate ?? null,
        originDescription: validated.originDescription ?? null,
        originPlaceId: validated.originPlaceId ?? null,
        destinationLocationId: validated.destinationLocationId ?? null,
        destinationSubLocationId: validated.destinationSubLocationId ?? null,
        notes: validated.notes ?? null,
      })
      .returning(),
    d.insert(orderStatusHistory).values({
      orderId: id,
      fromStatus: null,
      toStatus: status,
      notes: "Order created",
    }),
  ];
}

export async function createOrder(input: CreateOrderInput) {
  const validated = createOrderSchema.parse(input);
  await requireBookWork(validated.workId);
  const status: OrderStatus = validated.status ?? "placed";

  // The order and its first history row are one write
  const [inserted] = await atomic((d) =>
    newOrderQueries(d, randomUUID(), validated.workId, validated, status),
  );
  const [order] = inserted as (typeof orders.$inferSelect)[];

  // Sync work catalogue status from all orders for this work
  await syncWorkCatalogueStatusFromAllOrders(
    validated.workId,
    `Order created with status "${status}"`,
  );

  invalidate(CACHE_TAGS.orders);
  return order;
}

const newBookSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500),
  authorName: z.string().trim().min(1, "Author is required").max(300),
});

/**
 * Orders a book the catalogue does not have yet. The author (found by name or
 * created), the book (on order) and the order with its first history row are
 * one write, so a failure or a cancelled dialog leaves no book behind.
 */
export async function createOrderForNewBook(input: {
  book: z.input<typeof newBookSchema>;
  order: OrderFields;
}) {
  const book = newBookSchema.parse(input.book);
  const validated = createOrderSchema.omit({ workId: true }).parse(input.order);
  const status: OrderStatus = validated.status ?? "placed";
  const author = await bookAuthorFor(book.authorName);
  const work = await planBookWork(
    createWorkSchema.parse({
      title: book.title,
      authorIds: [{ authorId: author.id, role: "author" }],
      catalogueStatus: "on_order",
    }),
    author.name,
  );
  let orderAt = -1;
  const results = await atomic((d) => {
    const queries: unknown[] = [...newAuthorQueries(d, author), ...work.queries(d)];
    orderAt = queries.length;
    queries.push(...newOrderQueries(d, randomUUID(), work.id, validated, status));
    return queries;
  });
  const [order] = results[orderAt] as (typeof orders.$inferSelect)[];

  await syncWorkCatalogueStatusFromAllOrders(
    work.id,
    `Order created with status "${status}"`,
  );
  invalidate(CACHE_TAGS.orders, CACHE_TAGS.works, CACHE_TAGS.authors);
  return { order, slug: work.slug };
}

export async function updateOrder(id: string, rawInput: UpdateOrderInput) {
  parseId(id);
  // No defaults, unknown keys rejected; the currency is checked here too
  const input = updateOrderSchema.parse(rawInput);
  if (input.workId !== undefined) await requireBookWork(input.workId);

  // H3: fetch current state to record what changed
  const current = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { workId: true },
  });

  const [updated] = await db
    .update(orders)
    .set({
      ...(input.workId !== undefined ? { workId: input.workId } : {}),
      ...(input.acquisitionTargetId !== undefined
        ? { acquisitionTargetId: input.acquisitionTargetId }
        : {}),
      ...(input.editionId !== undefined ? { editionId: input.editionId } : {}),
      ...(input.instanceId !== undefined
        ? { instanceId: input.instanceId }
        : {}),
      ...(input.venueId !== undefined ? { venueId: input.venueId } : {}),
      ...(input.acquisitionMethod !== undefined
        ? { acquisitionMethod: input.acquisitionMethod }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.orderDate !== undefined ? { orderDate: input.orderDate } : {}),
      ...(input.orderConfirmation !== undefined
        ? { orderConfirmation: input.orderConfirmation }
        : {}),
      ...(input.orderUrl !== undefined ? { orderUrl: input.orderUrl } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.shippingCost !== undefined
        ? { shippingCost: input.shippingCost }
        : {}),
      ...(input.totalCost !== undefined ? { totalCost: input.totalCost } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.carrier !== undefined ? { carrier: input.carrier } : {}),
      ...(input.trackingNumber !== undefined
        ? { trackingNumber: input.trackingNumber }
        : {}),
      ...(input.trackingUrl !== undefined
        ? { trackingUrl: input.trackingUrl }
        : {}),
      ...(input.shippedDate !== undefined
        ? { shippedDate: input.shippedDate }
        : {}),
      ...(input.estimatedDeliveryDate !== undefined
        ? { estimatedDeliveryDate: input.estimatedDeliveryDate }
        : {}),
      ...(input.actualDeliveryDate !== undefined
        ? { actualDeliveryDate: input.actualDeliveryDate }
        : {}),
      ...(input.originDescription !== undefined
        ? { originDescription: input.originDescription }
        : {}),
      ...(input.originPlaceId !== undefined
        ? { originPlaceId: input.originPlaceId }
        : {}),
      ...(input.destinationLocationId !== undefined
        ? { destinationLocationId: input.destinationLocationId }
        : {}),
      ...(input.destinationSubLocationId !== undefined
        ? { destinationSubLocationId: input.destinationSubLocationId }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, id))
    .returning();

  // H3: record activity event for field edits
  if (current) {
    recordActivity("work", current.workId, "work.order_updated", {
      extra: { orderId: id },
    });
  }

  invalidate(CACHE_TAGS.orders);
  return updated;
}

export async function updateOrderStatus(
  id: string,
  newStatus: OrderStatus,
  notes?: string,
) {
  parseId(id);
  newStatus = orderStatusSchema.parse(newStatus);
  notes = z.string().max(5000).optional().parse(notes);
  const current = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      status: true,
      acquisitionMethod: true,
      shippedDate: true,
      actualDeliveryDate: true,
      workId: true,
    },
  });

  if (!current) throw new Error("Order not found");

  // C5: server-side transition validation
  const valid = getValidTransitions(
    current.status as OrderStatus,
    current.acquisitionMethod as AcquisitionMethod,
  );
  if (!valid.includes(newStatus)) {
    throw new Error(
      `Invalid transition from "${current.status}" to "${newStatus}" for method "${current.acquisitionMethod}"`,
    );
  }

  const fromStatus = current.status;
  const today = new Date().toISOString().split("T")[0];

  // C6: only auto-set dates when the field is currently null
  const additionalFields: Record<string, unknown> = {};
  if (
    (newStatus === "shipped" || newStatus === "in_transit") &&
    !current.shippedDate
  ) {
    additionalFields.shippedDate = today;
  }
  if (
    (newStatus === "delivered" ||
      newStatus === "purchased" ||
      newStatus === "received") &&
    !current.actualDeliveryDate
  ) {
    additionalFields.actualDeliveryDate = today;
  }

  // The change, checked against the status it was validated from, and its
  // history row are one write: a concurrent change makes this one fail
  const results = await atomic((d) => [
    d.execute(sql`select id from orders where id=${id}::uuid for update`),
    d.execute(
      assertSql(
        sql`exists(select 1 from orders where id=${id}::uuid and status=${fromStatus})`,
        "The order changed; reload before changing its status",
      ),
    ),
    d
      .update(orders)
      .set({ status: newStatus, ...additionalFields, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning(),
    d.insert(orderStatusHistory).values({
      orderId: id,
      fromStatus,
      toStatus: newStatus,
      notes: notes ?? null,
    }),
  ]);
  const [updated] = results[2] as (typeof orders.$inferSelect)[];

  // C1: always sync work status from all orders (handles cancel, return, delivery)
  await syncWorkCatalogueStatusFromAllOrders(
    updated.workId,
    `Order status changed to "${newStatus}"`,
  );

  invalidate(CACHE_TAGS.orders);
  return updated;
}

export async function deleteOrder(id: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { status: true, workId: true },
  });

  if (!order) throw new Error("Order not found");

  // M2: guard against all book-in-hand statuses, not just "delivered"
  if (BOOK_IN_HAND_STATUSES.includes(order.status as OrderStatus)) {
    throw new Error(
      `Cannot delete a "${order.status}" order. Consider updating its status instead.`,
    );
  }

  // The order's own status history goes with it (ON DELETE CASCADE), so the
  // deletion is recorded on the work's activity timeline instead.
  await db.delete(orders).where(eq(orders.id, id));

  recordActivity("work", order.workId, "work.order_deleted", {
    oldValue: order.status,
    extra: { orderId: id },
  });

  // C2: sync work status after removing order
  await syncWorkCatalogueStatusFromAllOrders(
    order.workId,
    `Order deleted (was "${order.status}")`,
  );

  invalidate(CACHE_TAGS.orders);
  return { id };
}

export async function searchWorksForOrder(query: string) {
  const { works } = await import("@/lib/db/schema");
  const { ilike } = await import("drizzle-orm");

  return db.query.works.findMany({
    where: and(bookCondition, ilike(works.title, containsPattern(query))),
    limit: 20,
    orderBy: asc(works.title),
    with: {
      workAuthors: {
        with: { author: { columns: { id: true, name: true } } },
        orderBy: (wa) => asc(wa.sortOrder),
        limit: 1,
      },
      media: {
        columns: {
          s3Key: true,
          thumbnailS3Key: true,
          type: true,
          isActive: true,
          cropX: true,
          cropY: true,
          cropZoom: true,
          brightness: true,
          contrast: true,
        },
      },
    },
  });
}
