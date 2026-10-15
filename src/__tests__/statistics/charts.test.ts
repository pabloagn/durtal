import { describe, expect, it } from "vitest";
import { decadeBuckets, decadeLabel, percentOf, yearBuckets, yearLabel } from "@/lib/statistics/charts";

/* The library statistics' chart buckets (SLN-742). */

describe("labels", () => {
  it("writes years and decades before the common era with BC", () => {
    expect([1957, 0, -800].map(yearLabel)).toEqual(["1957", "0", "800 BC"]);
    expect([1950, -800].map(decadeLabel)).toEqual(["1950s", "800s BC"]);
  });

  it("rounds a share to a whole percent, 0 of nothing", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("years", () => {
  it("draws every year from the first to the last, empty ones included", () => {
    const { bars, earlier, from } = yearBuckets([
      { year: 1957, count: 2 },
      { year: 1954, count: 1 },
    ]);
    expect(bars.map((b) => [b.label, b.count])).toEqual([
      ["1954", 1],
      ["1955", 0],
      ["1956", 0],
      ["1957", 2],
    ]);
    expect(earlier).toBe(0);
    expect(from).toBe(1954);
  });

  it("starts at the decade of the earliest 2% and counts the older books apart", () => {
    const years = [{ year: -800, count: 1 }, ...Array.from({ length: 99 }, (_, i) => ({ year: 1901 + i, count: 1 }))];
    const { bars, earlier, from } = yearBuckets(years);
    expect(from).toBe(1900);
    expect(bars[0].label).toBe("1900");
    expect(bars.at(-1)!.label).toBe("1999");
    expect(earlier).toBe(1);
    expect(bars.reduce((s, b) => s + b.count, 0) + earlier).toBe(100);
  });

  it("never shows more than 200 years", () => {
    const years = Array.from({ length: 50 }, (_, i) => ({ year: 1500 + i * 10, count: 1 }));
    const { bars, earlier } = yearBuckets(years);
    expect(bars).toHaveLength(200);
    expect(bars.at(-1)!.label).toBe("1990");
    expect(earlier + bars.reduce((s, b) => s + b.count, 0)).toBe(50);
  });

  it("is empty without books", () => {
    expect(yearBuckets([])).toEqual({ bars: [], earlier: 0, from: null });
    expect(decadeBuckets([])).toEqual([]);
  });
});

describe("decades", () => {
  it("sums the years of each decade and keeps empty decades", () => {
    expect(
      decadeBuckets([
        { year: 1921, count: 1 },
        { year: 1929, count: 2 },
        { year: 1945, count: 1 },
      ]).map((b) => [b.label, b.count]),
    ).toEqual([
      ["1920s", 3],
      ["1930s", 0],
      ["1940s", 1],
    ]);
  });

  it("gathers the decades past sixty into one bar before them", () => {
    const bars = decadeBuckets([
      { year: -800, count: 2 },
      { year: 1400, count: 1 },
      { year: 2020, count: 4 },
    ]);
    expect(bars).toHaveLength(61);
    expect(bars[0]).toEqual({ start: null, label: "Before 1430", count: 3 });
    expect(bars[1].label).toBe("1430s");
    expect(bars.at(-1)).toEqual({ start: 2020, label: "2020s", count: 4 });
  });
});
