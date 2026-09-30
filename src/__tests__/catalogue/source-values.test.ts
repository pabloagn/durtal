import { describe, it, expect } from "vitest";
import {
  catalogueDateSchema,
  normalizeCatalogueDate,
  displayCatalogueDate,
  legacyYearDate,
} from "@/lib/catalogue/dates";
import { normalizeMeasurement } from "@/lib/catalogue/measurements";
import {
  sourceUrlSchema,
  proposeSourcedChanges,
} from "@/lib/catalogue/provenance";

describe("precise and uncertain civil dates", () => {
  it("retains missing components while computing separate sortable bounds", () => {
    expect(
      normalizeCatalogueDate({ precision: "year", start: { year: 1905 } }),
    ).toMatchObject({
      start: { year: 1905, month: null, day: null },
      lowerBound: 19050101,
      upperBound: 19051231,
    });
    expect(
      normalizeCatalogueDate({
        precision: "month",
        start: { year: 2000, month: 2 },
      }),
    ).toMatchObject({
      start: { day: null },
      lowerBound: 20000201,
      upperBound: 20000229,
    });
    expect(
      normalizeCatalogueDate({ precision: "unknown", label: "Date unknown" }),
    ).toMatchObject({
      start: null,
      end: null,
      label: "Date unknown",
      lowerBound: null,
      upperBound: null,
    });
  });
  it("preserves uncertainty and source labels for ranges", () => {
    const date = {
      precision: "range" as const,
      start: { year: 1900 },
      end: { year: 1905, month: 2 },
      approximate: true,
      label: "circa 1900–February 1905",
    };
    expect(normalizeCatalogueDate(date)).toMatchObject({
      lowerBound: 19000101,
      upperBound: 19050228,
      approximate: true,
    });
    expect(displayCatalogueDate(date)).toBe(date.label);
    expect(displayCatalogueDate({ ...date, label: null })).toBe(
      "c. 1900–1905-02",
    );
  });
  it("sorts BCE dates and handles civil year boundaries without year zero", () => {
    const bce = normalizeCatalogueDate({
      precision: "day",
      start: { year: -1, month: 2, day: 29 },
    });
    expect(bce.lowerBound).toBe(-9771);
    expect(displayCatalogueDate(bce)).toBe("1-02-29 BCE");
    expect(
      normalizeCatalogueDate({
        precision: "range",
        start: { year: -1 },
        end: { year: 1 },
      }),
    ).toMatchObject({ lowerBound: -9899, upperBound: 11231 });
    expect(
      normalizeCatalogueDate({ precision: "year", start: { year: 999999 } })
        .upperBound,
    ).toBe(9999991231);
  });
  it.each([
    { precision: "year", start: { year: 0 } },
    { precision: "year", start: { year: 1000000 } },
    { precision: "year", start: { year: 1900, month: 1 } },
    { precision: "day", start: { year: 1900, month: 2, day: 29 } },
    { precision: "day", start: { year: 2024, month: 4, day: 31 } },
    { precision: "day", start: { year: 2024, day: 1 } },
    { precision: "month", start: { year: 2024 } },
    { precision: "unknown", start: { year: 2024 } },
    { precision: "range", start: { year: 2025 }, end: { year: 2024 } },
    {
      precision: "range",
      start: { year: 2024, month: 6 },
      end: { year: 2024, month: 5 },
    },
    { precision: "range", start: { year: 2024 } },
  ])("rejects invalid dates or invented precision: %j", (value) => {
    expect(catalogueDateSchema.safeParse(value).success).toBe(false);
  });
  it("adapts legacy years without adding days or mutating originals", () => {
    expect(legacyYearDate(null).precision).toBe("unknown");
    expect(legacyYearDate(1857)).toMatchObject({
      precision: "year",
      start: { year: 1857, month: null, day: null },
    });
    // An invalid historic year requires review; no silent coercion to year 1.
    expect(() => legacyYearDate(0)).toThrow();
  });
});

describe("domain-safe measurements and sources", () => {
  it("uses explicit canonical units", () => {
    expect(normalizeMeasurement("painting", { value: 1, unit: "in" })).toEqual({
      value: 25.4,
      unit: "mm",
    });
    expect(normalizeMeasurement("painting", { value: 50, unit: "cm" })).toEqual(
      { value: 500, unit: "mm" },
    );
    expect(normalizeMeasurement("perfume", { value: 0.1, unit: "l" })).toEqual({
      value: 100,
      unit: "ml",
    });
    expect(normalizeMeasurement("film", { value: 95.5, unit: "min" })).toEqual({
      value: 5730,
      unit: "s",
    });
  });
  it.each([NaN, Infinity, -1, 0, 1e10])(
    "rejects invalid measurements: %s",
    (value) => {
      expect(() =>
        normalizeMeasurement("perfume", { value, unit: "ml" }),
      ).toThrow();
    },
  );
  it("rejects foreign units and ambiguous fluid ounces", () => {
    for (const kind of ["painting", "perfume", "film"] as const)
      expect(() =>
        normalizeMeasurement(kind, { value: 2, unit: "oz" }),
      ).toThrow();
    expect(() =>
      normalizeMeasurement("painting", { value: 2, unit: "ml" }),
    ).toThrow();
    expect(() =>
      normalizeMeasurement("film", { value: 2, unit: "cm" }),
    ).toThrow();
  });
  it.each([
    "javascript:alert(1)",
    "file:///tmp/data",
    "ftp://example.com",
    "https://user:password@example.com",
    "not a URL",
  ])("rejects unsafe source links: %s", (value) => {
    expect(sourceUrlSchema.safeParse(value).success).toBe(false);
  });
  it("proposes missing values but preserves conflicts, manual locks and equivalent objects", () => {
    const current = {
      title: "Curated title",
      date: null,
      notes: null,
      image: null,
      nested: { a: 1, b: 2 },
      count: 0,
    };
    const before = structuredClone(current);
    const result = proposeSourcedChanges<Record<string, unknown>>(
      current,
      {
        title: "Provider title",
        date: { precision: "year", start: { year: 1900 } },
        notes: "Provider notes",
        image: null,
        nested: { b: 2, a: 1 },
        count: 1,
      },
      ["notes"],
    );
    expect(result.changes).toEqual({
      date: { precision: "year", start: { year: 1900 } },
    });
    expect(
      result.conflicts.map(({ field, reason }) => ({ field, reason })),
    ).toEqual([
      { field: "title", reason: "different" },
      { field: "notes", reason: "locked" },
      { field: "count", reason: "different" },
    ]);
    expect(current).toEqual(before);
  });
});
