import { describe, expect, it } from "vitest";
import { describeLocationItems, locationItemCount, locationItemTotal, NO_LOCATION_ITEMS } from "@/lib/catalogue/location-items";

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

  // A location's one count names what it holds, book copies as Statistics does (SLN-886)
  it("counts book copies as copies, one other kind by its name, and several as items", () => {
    expect(locationItemCount({ ...NO_LOCATION_ITEMS, copies: 15 })).toBe("15 copies");
    expect(locationItemCount({ ...NO_LOCATION_ITEMS, copies: 1 })).toBe("1 copy");
    expect(locationItemCount({ ...NO_LOCATION_ITEMS, paintings: 2 })).toBe("2 paintings");
    expect(locationItemCount({ ...NO_LOCATION_ITEMS, perfumes: 1 })).toBe("1 perfume bottle");
    expect(locationItemCount(items)).toBe("6 items");
    expect(locationItemCount(NO_LOCATION_ITEMS)).toBe("0 items");
    expect(locationItemCount({ ...NO_LOCATION_ITEMS, copies: 1200 })).toBe("1,200 copies");
    expect(locationItemCount({ ...NO_LOCATION_ITEMS, copies: 1200, films: 1 })).toBe("1,201 items");
  });
});
