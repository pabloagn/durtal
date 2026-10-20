import { and, desc, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { TERMINAL_STATUSES, orderHref } from "@/lib/constants/orders";
import { formatDate } from "@/lib/utils/format";

/**
 * The target's open order (placed and not yet delivered, received, returned
 * or cancelled), newest first, as the sentence and the link New order shows
 * before ordering it again (SLN-1119)
 */
export async function openTargetOrder(targetId: string) {
  const [order] = await db
    .select({ id: orders.id, orderDate: orders.orderDate })
    .from(orders)
    .where(and(eq(orders.acquisitionTargetId, targetId), notInArray(orders.status, TERMINAL_STATUSES)))
    .orderBy(desc(orders.orderDate), desc(orders.createdAt))
    .limit(1);
  if (!order) return null;
  return {
    message: `This target already has an open order, placed ${formatDate(order.orderDate)}.`,
    href: orderHref(order.id),
  };
}
