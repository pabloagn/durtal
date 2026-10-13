import { describe, expect, it } from "vitest";
import { describeLocationItems, locationItemTotal, NO_LOCATION_ITEMS } from "@/lib/catalogue/location-items";

describe("location items", () => {
  const items = { copies: 3, films: 1, paintings: 0, perfumes: 2 };

  it("totals every kind", () => {
    expect(locationItemTotal(items)).toBe(6);
    expect(locationItemTotal(NO_LOCATION_ITEMS)).toBe(0);
  });

  it("names each kind held, in one sentence, leaving out the empty ones", () => {
    expect(describeLocationItems(items)).toBe("3 book copies, 1 film copy and 2 perfume bottles");
    expect(describeLocationItems(items, ["films", "paintings", "perfumes"])).toBe("1 film copy and 2 perfume bottles");
    expect(describeLocationItems({ ...items, copies: 1 }, ["copies"])).toBe("1 book copy");
    expect(describeLocationItems({ ...NO_LOCATION_ITEMS, paintings: 1 })).toBe("1 painting");
    expect(describeLocationItems(NO_LOCATION_ITEMS)).toBe("");
  });
});
