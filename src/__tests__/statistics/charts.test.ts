import { describe, expect, it } from "vitest";
import { compactYearCounts, decadeBuckets, decadeLabel, percentOf, yearBuckets, yearLabel } from "@/lib/statistics/charts";

/* The library statistics' chart buckets (SLN-742). */

describe("compact year transport", () => {
  it.each([
    { years: [] },
    { years: [{ year: -800, count: 2 }, { year: 0, count: 1 }, { year: 1884, count: 9 }, { year: 2026, count: 3 }] },
    { years: Array.from({ length: 573 }, (_, i) => ({ year: 1451 + i, count: 1 + i % 8 })) },
  ])("preserves both chart views, labels, gaps and earlier counts", ({ years }) => {
    const restored = compactYearCounts(years).map(([year, count]) => ({ year, count }));
    expect(restored).toEqual(years);
    expect(yearBuckets(restored)).toEqual(yearBuckets(years));
    expect(decadeBuckets(restored)).toEqual(decadeBuckets(years));
  });

  it("cuts the 573-year payload by more than half without losing counts", () => {
    const years = Array.from({ length: 573 }, (_, i) => ({ year: 1451 + i, count: 1 + i % 8 }));
    expect(JSON.stringify(compactYearCounts(years)).length).toBeLessThan(JSON.stringify(years).length / 2);
  });
});

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
    const years = Array.from({ length: 80 }, (_, i) => ({ year: 1215 + i * 10, count: 1 }));
    const bars = decadeBuckets([{ year: -800, count: 2 }, ...years]);
    expect(bars).toHaveLength(61);
    expect(bars[0]).toEqual({ start: null, label: "Before 1410", count: 2 + 20 });
    expect(bars[1].label).toBe("1410s");
    expect(bars.at(-1)).toEqual({ start: 2000, label: "2000s", count: 1 });
  });

  it("stops at a long run of empty decades, so a few ancient books leave no blank chart", () => {
    const bars = decadeBuckets([
      { year: -800, count: 1 },
      { year: 1200, count: 1 },
      { year: 1857, count: 2 },
      { year: 1884, count: 3 },
      { year: 1957, count: 4 },
    ]);
    expect(bars[0]).toEqual({ start: null, label: "Before 1850", count: 2 });
    expect(bars[1]).toEqual({ start: 1850, label: "1850s", count: 2 });
    expect(bars.at(-1)).toEqual({ start: 1950, label: "1950s", count: 4 });
    expect(bars).toHaveLength(12);
    // A short gap is part of the history: the 1950s and 1880s stay one chart
    expect(bars.filter((b) => b.count === 0)).toHaveLength(8);
  });

  it("crosses a long empty run when most books lie beyond it", () => {
    // An old library and one new book: the chart is the old library, not "Before 2020"
    const years = Array.from({ length: 50 }, (_, i) => ({ year: 1850 + i, count: 2 }));
    const bars = decadeBuckets([...years, { year: 2021, count: 1 }]);
    expect(bars[0]).toEqual({ start: 1850, label: "1850s", count: 20 });
    expect(bars.at(-1)).toEqual({ start: 2020, label: "2020s", count: 1 });
    expect(bars).toHaveLength(18);
  });
});
