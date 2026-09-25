import { describe, expect, it } from "vitest";
import { nextCatalogueStatus, type CatalogueStatus } from "@/lib/utils/order-status-sync";

const next = (current: CatalogueStatus, o: { inHand?: boolean; active?: boolean; before?: CatalogueStatus | null }) =>
  nextCatalogueStatus({
    current,
    hasBookInHand: o.inHand ?? false,
    hasActiveOrder: o.active ?? false,
    statusBeforeOrdering: o.before ?? null,
  });

describe("nextCatalogueStatus", () => {
  it("never demotes an owned work when another copy is ordered, cancelled or deleted", () => {
    // acceptance: owned work + new order + cancel/delete → still accessioned
    expect(next("accessioned", { active: true })).toBe("accessioned");
    expect(next("accessioned", {})).toBe("accessioned");
  });

  it("follows a wanted work through order → delivery", () => {
    let s: CatalogueStatus = "wanted";
    s = next(s, { active: true });
    expect(s).toBe("on_order");
    s = next(s, { inHand: true });
    expect(s).toBe("accessioned");
  });

  it("returns a cancelled order's work to the status it had before ordering", () => {
    // acceptance: wanted work + order → on_order; order cancelled → back to wanted
    expect(next("on_order", { before: "wanted" })).toBe("wanted");
    expect(next("on_order", { before: "shortlisted" })).toBe("shortlisted");
    expect(next("on_order", { before: "tracked" })).toBe("tracked");
    // a book that was owned before the second copy was ordered (data from before the fix)
    expect(next("on_order", { before: "accessioned" })).toBe("accessioned");
  });

  it("falls back to wanted when the pre-order status is unknown", () => {
    expect(next("on_order", { before: null })).toBe("wanted");
    expect(next("on_order", { before: "on_order" })).toBe("wanted");
  });

  it("promotes any not-owned status while an order is open", () => {
    for (const s of ["tracked", "shortlisted", "wanted", "deaccessioned"] as const) {
      expect(next(s, { active: true })).toBe("on_order");
    }
  });

  it("marks the work owned as soon as any order is in hand", () => {
    for (const s of ["tracked", "wanted", "on_order", "deaccessioned", "accessioned"] as const) {
      expect(next(s, { inHand: true, active: true })).toBe("accessioned");
    }
  });

  it("leaves other statuses alone when no order is open", () => {
    // e.g. a delivered order later returned: the app cannot know, so ownership is kept
    for (const s of ["tracked", "shortlisted", "wanted", "accessioned", "deaccessioned"] as const) {
      expect(next(s, {})).toBe(s);
    }
  });
});
