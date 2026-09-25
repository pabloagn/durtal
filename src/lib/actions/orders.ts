"use server";

import { db } from "@/lib/db";
import { orders, orderStatusHistory, works, workStatusHistory } from "@/lib/db/schema";
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
} from "drizzle-orm";
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
  getValidTransitions,
} from "@/lib/constants/orders";
import { recordActivity } from "@/lib/activity/record";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { createOrderSchema } from "@/lib/validations/orders";
import { nextCatalogueStatus, type CatalogueStatus } from "@/lib/utils/order-status-sync";

/**
 * Keep a work's catalogueStatus in line with ALL its orders (C1, H4), without
 * ever demoting a book that is owned. The rules live in nextCatalogueStatus().
 */
async function syncWorkCatalogueStatusFromAllOrders(
  workId: string,
  notes: string,
) {
  const [allOrders, work] = await Promise.all([
    db.query.orders.findMany({
      where: eq(orders.workId, workId),
      columns: { status: true },
    }),
    db.query.works.findFirst({
      where: eq(works.id, workId),
      columns: { catalogueStatus: true },
    }),
  ]);
  if (!work) return;

  const current = work.catalogueStatus as CatalogueStatus;
  const hasBookInHand = allOrders.some((o) =>
    BOOK_IN_HAND_STATUSES.includes(o.status as OrderStatus),
  );
  const hasActiveOrder = allOrders.some(
    (o) => !(TERMINAL_STATUSES as string[]).includes(o.status),
  );

  // Only needed when a work leaves on_order: the status it had before it was ordered
  let statusBeforeOrdering: CatalogueStatus | null = null;
  if (current === "on_order" && !hasBookInHand && !hasActiveOrder) {
    const lastOrdered = await db.query.workStatusHistory.findFirst({
      where: and(
        eq(workStatusHistory.workId, workId),
        eq(workStatusHistory.toStatus, "on_order"),
      ),
      orderBy: desc(workStatusHistory.changedAt),
      columns: { fromStatus: true },
    });
    statusBeforeOrdering = (lastOrdered?.fromStatus as CatalogueStatus | null) ?? null;
  }

  const targetStatus = nextCatalogueStatus({ current, hasBookInHand, hasActiveOrder, statusBeforeOrdering });
  if (targetStatus === current) return;

  await db
    .update(works)
    .set({ catalogueStatus: targetStatus })
    .where(eq(works.id, workId));

  await db.insert(workStatusHistory).values({
    workId,
    fromStatus: current,
    toStatus: targetStatus,
    notes,
  });

  recordActivity("work", workId, "work.catalogue_status_changed", {
    oldValue: current,
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
      orderBy: desc(orders.orderDate),
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
    activeCountResult,
    inTransitCountResult,
    arrivingThisWeekResult,
  ] = await Promise.all([
    db
      .select({
        totalSpent: sum(orders.totalCost),
        avgOrderCost: avg(orders.totalCost),
        orderCount: count(),
      })
      .from(orders)
      .where(where),

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

  return {
    totalSpent: totalStatsResult[0]?.totalSpent ?? "0",
    avgOrderCost: totalStatsResult[0]?.avgOrderCost ?? "0",
    orderCount: totalStatsResult[0]?.orderCount ?? 0,
    activeOrders: activeCountResult[0]?.count ?? 0,
    inTransit: inTransitCountResult[0]?.count ?? 0,
    arrivingThisWeek: arrivingThisWeekResult[0]?.count ?? 0,
  };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput) {
  const validated = createOrderSchema.parse(input);
  const status: OrderStatus = validated.status ?? "placed";

  const [order] = await db
    .insert(orders)
    .values({
      workId: validated.workId,
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
    .returning();

  // Create initial status history entry
  await db.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: null,
    toStatus: status,
    notes: "Order created",
  });

  // Sync work catalogue status from all orders for this work
  await syncWorkCatalogueStatusFromAllOrders(
    validated.workId,
    `Order created with status "${status}"`,
  );

  invalidate(CACHE_TAGS.orders);
  return order;
}

export async function updateOrder(id: string, input: UpdateOrderInput) {
  // H3: fetch current state to record what changed
  const current = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { workId: true },
  });

  const [updated] = await db
    .update(orders)
    .set({
      ...(input.workId !== undefined ? { workId: input.workId } : {}),
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
  const current = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { status: true, acquisitionMethod: true, shippedDate: true, actualDeliveryDate: true, workId: true },
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

  const [updated] = await db
    .update(orders)
    .set({ status: newStatus, ...additionalFields, updatedAt: new Date() })
    .where(eq(orders.id, id))
    .returning();

  await db.insert(orderStatusHistory).values({
    orderId: id,
    fromStatus,
    toStatus: newStatus,
    notes: notes ?? null,
  });

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

  // The order's own status history is removed with it (ON DELETE CASCADE),
  // so the deletion is recorded on the work's activity timeline instead.
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

  // L1: escape SQL pattern characters to prevent unintended matches
  const escaped = query.replace(/[%_\\]/g, (c) => `\\${c}`);

  return db.query.works.findMany({
    where: ilike(works.title, `%${escaped}%`),
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
        },
      },
    },
  });
}
