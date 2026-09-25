export type CatalogueStatus = "tracked" | "shortlisted" | "wanted" | "on_order" | "accessioned" | "deaccessioned";

export interface OrderStatusFacts {
  /** The work's current catalogue status. */
  current: CatalogueStatus;
  /** At least one order is delivered / received / purchased / won. */
  hasBookInHand: boolean;
  /** At least one order is still open (not terminal). */
  hasActiveOrder: boolean;
  /** Status the work had before it was first set to on_order (from its status history), if known. */
  statusBeforeOrdering: CatalogueStatus | null;
}

/**
 * Catalogue status a work should have after an order changes.
 *
 * Orders only ever promote a work; they never demote a book that is owned:
 * - a book-in-hand order → accessioned;
 * - an open order → on_order, unless the work is already accessioned
 *   (ordering another copy of an owned book keeps it owned);
 * - no open or in-hand order left → a work that is still on_order goes back
 *   to the status it had before it was ordered ("wanted" when unknown);
 *   every other status is left unchanged.
 */
export function nextCatalogueStatus(facts: OrderStatusFacts): CatalogueStatus {
  const { current, hasBookInHand, hasActiveOrder, statusBeforeOrdering } = facts;
  if (hasBookInHand) return "accessioned";
  if (hasActiveOrder) return current === "accessioned" ? current : "on_order";
  if (current === "on_order") {
    return statusBeforeOrdering && statusBeforeOrdering !== "on_order" ? statusBeforeOrdering : "wanted";
  }
  return current;
}
