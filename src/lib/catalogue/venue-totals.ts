/**
 * A venue's order totals (`total_orders`, `total_spent`, `last_order_date`)
 * are unused and will be dropped (SLN-1307). Every Drizzle read of a venue
 * leaves them out, so the release that drops them does not break this one.
 */
export const WITHOUT_VENUE_TOTALS = { totalOrders: false, totalSpent: false, lastOrderDate: false } as const;
