import { describe, expect, it } from "vitest";
import { createVenueSchema, updateVenueSchema } from "@/lib/validations/venues";
import { retailerObservationSchema, retailerObservationAge } from "@/lib/catalogue/retailers";
const id = "00000000-0000-4000-8000-000000000001";
describe("venue and retailer input contracts", () => {
  it.each(["javascript:alert(1)", "https://user:pass@example.com", "not a URL"])("rejects unsafe website %s", website => {
    expect(createVenueSchema.safeParse({ name: "Venue", type: "perfumery", website }).success).toBe(false);
    expect(updateVenueSchema.safeParse({ website }).success).toBe(false);
  });
  it("rejects injected fields and invalid calendar dates on edit", () => {
    for (const input of [{ slug: "rewrite" }, { totalSpent: "1000" }, { firstVisitDate: "2026-02-30" }, { timezone: "Moon/Sea" }, { type: "perfume" }]) expect(updateVenueSchema.safeParse(input).success).toBe(false);
  });
  it("keeps unknown price and capacity unknown and rejects inconsistent offers", () => {
    const base = { linkId: id, checkedAt: "2026-09-01T12:00:00Z" };
    expect(retailerObservationSchema.parse(base)).toEqual({ ...base, availability: "unknown" });
    for (const fields of [{ price: 10 }, { currency: "EUR" }, { price: 10.001, currency: "EUR" }, { capacityMl: 50 }, { capacityMl: 0, container: "sample" }, { capacityMl: 0.0001, container: "sample" }, { availability: "available_forever" }]) expect(retailerObservationSchema.safeParse({ ...base, ...fields }).success).toBe(false);
    expect(retailerObservationSchema.parse({ ...base, price: 0, currency: "EUR", capacityMl: 1.5, container: "sample" }).price).toBe(0);
  });
  it("treats never checked and expired observations distinctly", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    expect(retailerObservationAge(null, now)).toEqual({ ageDays: null, isStale: true });
    expect(retailerObservationAge("2026-09-01T12:00:00Z", now)).toEqual({ ageDays: 29, isStale: false });
    expect(retailerObservationAge("2026-08-31T12:00:00Z", now)).toEqual({ ageDays: 30, isStale: true });
    expect(retailerObservationAge("2026-09-30T12:01:00Z", now)).toEqual({ ageDays: 0, isStale: false });
  });
});
