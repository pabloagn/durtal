import { describe, expect, it } from "vitest";
import { byAddRecency } from "@/lib/collections/recency";

describe("byAddRecency", () => {
  const rows = [
    { id: "4", name: "beta" },
    { id: "1", name: "Alpha" },
    { id: "3", name: "Gamma" },
    { id: "2", name: "alpha" },
  ];
  it("puts the most recent addition first, then the rest by name and id", () => {
    const lastAdded = new Map([["3", 10], ["4", 20]]);
    expect(byAddRecency(rows, lastAdded).map((r) => r.id)).toEqual(["4", "3", "1", "2"]);
    // A copy: the rows passed in keep their order
    expect(rows.map((r) => r.id)).toEqual(["4", "1", "3", "2"]);
  });
  it("orders by name alone with no history, and by name on a tie", () => {
    expect(byAddRecency(rows, new Map()).map((r) => r.id)).toEqual(["1", "2", "4", "3"]);
    expect(byAddRecency(rows, new Map([["3", 5], ["4", 5]])).map((r) => r.id)).toEqual(["4", "3", "1", "2"]);
  });
});
