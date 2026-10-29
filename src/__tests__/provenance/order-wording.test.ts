import { afterEach, describe, expect, it } from "vitest";
import { formatDate, orderCardLabel, type OrderItem } from "@/app/(catalogue)/provenance/order-model";
const oldZone = process.env.TZ;
afterEach(() => { if (oldZone === undefined) delete process.env.TZ; else process.env.TZ = oldZone; });

describe("order dates and spoken card names (SLN-1122)", () => {
  it.each(["Pacific/Honolulu", "Europe/Amsterdam", "Pacific/Kiritimati"])("keeps a calendar date and its year in %s", (zone) => {
    process.env.TZ = zone;
    expect(formatDate("2026-10-04")).toBe("4 Oct 2026");
    expect(formatDate("2024-02-29")).toBe("29 Feb 2024");
  });
  it("names an absent date without punctuation standing for content", () => {
    expect(formatDate(null)).toBe("Not set");
    expect(formatDate(undefined)).toBe("Not set");
  });
  const order = { work: { title: "À rebours" }, status: "in_transit", orderDate: "2026-10-04" } as OrderItem;
  it.each([
    ["2026-10-04T23:59:00Z", "À rebours, in transit, ordered today"],
    ["2026-10-05T00:01:00Z", "À rebours, in transit, ordered 1 day ago"],
    ["2026-10-18T12:00:00Z", "À rebours, in transit, ordered 14 days ago"],
    ["2026-10-03T12:00:00Z", "À rebours, in transit, order date 4 Oct 2026"],
  ])("speaks a whole date or age at %s", (now, expected) => {
    expect(orderCardLabel(order, new Date(now))).toBe(expected);
  });
});
