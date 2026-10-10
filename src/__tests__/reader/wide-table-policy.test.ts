import { describe, expect, it } from "vitest";
import {
  physicalTableScrollLeft,
  tableCanTakeSwipe,
} from "@/lib/reader/media/table-policy";

describe("table gesture ownership", () => {
  const table = (left: number) => ({ left, width: 800, viewport: 300 });
  it("claims only movement toward available content at each edge", () => {
    expect(tableCanTakeSwipe(table(0), -50)).toBe(true);
    expect(tableCanTakeSwipe(table(0), 50)).toBe(false);
    expect(tableCanTakeSwipe(table(250), -50)).toBe(true);
    expect(tableCanTakeSwipe(table(250), 50)).toBe(true);
    expect(tableCanTakeSwipe(table(500), -50)).toBe(false);
    expect(tableCanTakeSwipe(table(500), 50)).toBe(true);
  });
  it("tolerates fractional edges and clamps elastic overscroll", () => {
    expect(tableCanTakeSwipe(table(499.8), -30)).toBe(false);
    expect(tableCanTakeSwipe(table(-10), 30)).toBe(false);
    expect(tableCanTakeSwipe(table(550), -30)).toBe(false);
  });
  it("normalizes RTL into the same physical directions", () => {
    expect(physicalTableScrollLeft(0, 500, "rtl")).toBe(500);
    expect(physicalTableScrollLeft(-500, 500, "rtl")).toBe(0);
    expect(
      tableCanTakeSwipe(table(physicalTableScrollLeft(-100, 500, "rtl")), -50),
    ).toBe(true);
  });
  it("does not claim non-scrollable, zero or invalid movement", () => {
    expect(tableCanTakeSwipe({ left: 0, width: 300, viewport: 300 }, -50)).toBe(
      false,
    );
    expect(tableCanTakeSwipe(table(100), 0)).toBe(false);
    expect(tableCanTakeSwipe(table(NaN), -50)).toBe(false);
    expect(tableCanTakeSwipe(table(100), Infinity)).toBe(false);
    expect(tableCanTakeSwipe({ left: 0, width: 300, viewport: 0 }, -50)).toBe(
      false,
    );
  });
});
