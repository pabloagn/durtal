"use server";

import { db } from "@/lib/db";
import { orders, orderStatusHistory } from "@/lib/db/schema";
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
  sql,
  isNull,
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
} from "@/lib/constants/orders";


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
            orderBy: (wa: any) => asc(wa.sortOrder),
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
        orderBy: (sh: any) => asc(sh.changedAt),
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
        orderBy: (sh: any) => desc(sh.changedAt),
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
            orderBy: (wa: any) => asc(wa.sortOrder),
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
              orderBy: (wa: any) => asc(wa.sortOrder),
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

    db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          isNotNull(orders.estimatedDeliveryDate),
          gte(orders.estimatedDeliveryDate, todayStr),
          lte(orders.estimatedDeliveryDate, sevenDaysStr),
          notInArray(orders.status, TERMINAL_STATUSES as OrderStatus[]),
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
  const status: OrderStatus = input.status ?? "placed";

  const [order] = await db
    .insert(orders)
    .values({
      workId: input.workId,
      editionId: input.editionId ?? null,
      instanceId: input.instanceId ?? null,
      venueId: input.venueId ?? null,
      acquisitionMethod: input.acquisitionMethod,
      status,
      orderDate: input.orderDate,
      orderConfirmation: input.orderConfirmation ?? null,
      orderUrl: input.orderUrl ?? null,
      price: input.price ?? null,
      shippingCost: input.shippingCost ?? null,
      totalCost: input.totalCost ?? null,
      currency: input.currency ?? null,
      carrier: input.carrier ?? null,
      trackingNumber: input.trackingNumber ?? null,
      trackingUrl: input.trackingUrl ?? null,
      shippedDate: input.shippedDate ?? null,
      estimatedDeliveryDate: input.estimatedDeliveryDate ?? null,
      actualDeliveryDate: input.actualDeliveryDate ?? null,
      originDescription: input.originDescription ?? null,
      originPlaceId: input.originPlaceId ?? null,
      destinationLocationId: input.destinationLocationId ?? null,
      destinationSubLocationId: input.destinationSubLocationId ?? null,
      notes: input.notes ?? null,
    })
    .returning();

  // Create initial status history entry
  await db.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: null,
    toStatus: status,
    notes: "Order created",
  });

  return order;
}

export async function updateOrder(id: string, input: UpdateOrderInput) {
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

  return updated;
}

export async function updateOrderStatus(
  id: string,
  newStatus: OrderStatus,
  notes?: string,
) {
  const current = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { status: true },
  });

  if (!current) throw new Error("Order not found");

  const fromStatus = current.status;

  const additionalFields: Record<string, unknown> = {};
  if (newStatus === "shipped" || newStatus === "in_transit") {
    additionalFields.shippedDate = new Date().toISOString().split("T")[0];
  }
  if (
    newStatus === "delivered" ||
    newStatus === "purchased" ||
    newStatus === "received"
  ) {
    additionalFields.actualDeliveryDate = new Date()
      .toISOString()
      .split("T")[0];
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

  return updated;
}

export async function deleteOrder(id: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { status: true },
  });

  if (!order) throw new Error("Order not found");

  if (order.status === "delivered") {
    throw new Error(
      "Cannot delete a delivered order. Consider updating its status instead.",
    );
  }

  await db.delete(orders).where(eq(orders.id, id));
  return { id };
}

export async function searchWorksForOrder(query: string) {
  const { works, workAuthors, authors, media } = await import(
    "@/lib/db/schema"
  );
  const { ilike } = await import("drizzle-orm");

  return db.query.works.findMany({
    where: ilike(works.title, `%${query}%`),
    limit: 20,
    orderBy: asc(works.title),
    with: {
      workAuthors: {
        with: { author: { columns: { id: true, name: true } } },
        orderBy: (wa: any) => asc(wa.sortOrder),
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
