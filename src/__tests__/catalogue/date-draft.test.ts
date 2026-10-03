import { describe, expect, it } from "vitest";
import { dateDraft, dateDraftValue, type DateDraft } from "@/lib/catalogue/date-draft";
import { catalogueDateSchema, catalogueDateText } from "@/lib/catalogue/dates";

const base = dateDraft(null);
const draft = (patch: Partial<DateDraft>) => ({ ...base, ...patch });

describe("date fields", () => {
  it("makes each precision from what was typed, as precise as typed", () => {
    expect(dateDraftValue(draft({ kind: "none" }))).toEqual({ value: null, error: null });
    expect(dateDraftValue(draft({ kind: "unknown" })).value).toEqual({
      precision: "unknown",
      label: null,
    });
    expect(dateDraftValue(draft({ kind: "year", year: "1925", approximate: true })).value).toEqual({
      precision: "year",
      start: { year: 1925 },
      approximate: true,
      label: null,
    });
    expect(dateDraftValue(draft({ kind: "month", year: "1925", month: "5" })).value).toMatchObject({
      precision: "month",
      start: { year: 1925, month: 5 },
    });
    expect(dateDraftValue(draft({ kind: "day", year: "2024", month: "2", day: "29" })).value).toMatchObject({
      precision: "day",
      start: { year: 2024, month: 2, day: 29 },
    });
    expect(dateDraftValue(draft({ kind: "range", year: "1920", endYear: "1929" })).value).toMatchObject({
      precision: "range",
      start: { year: 1920 },
      end: { year: 1929 },
    });
    expect(dateDraftValue(draft({ kind: "year", year: "44", bce: true })).value).toMatchObject({
      start: { year: -44 },
    });
  });

  it("says what is missing instead of inventing a date", () => {
    const error = (patch: Partial<DateDraft>) => dateDraftValue(draft(patch)).error;
    expect(error({ kind: "year", year: "" })).toBe("Enter a year");
    expect(error({ kind: "year", year: "19x" })).toBe("Enter a year");
    expect(error({ kind: "year", year: "0" })).toBe("There is no year 0");
    expect(error({ kind: "month", year: "1925" })).toBe("Choose a month");
    expect(error({ kind: "day", year: "2023", month: "2", day: "29" })).toBe("Enter a day of that month");
    expect(error({ kind: "range", year: "1929", endYear: "" })).toBe("Enter the last year");
    expect(error({ kind: "range", year: "1929", endYear: "1920" })).toBe(
      "The last year comes before the first",
    );
  });

  it("every date it makes is one the catalogue accepts, and reads back the same", () => {
    for (const patch of [
      { kind: "unknown" as const },
      { kind: "year" as const, year: "1925" },
      { kind: "month" as const, year: "1925", month: "12", approximate: true },
      { kind: "day" as const, year: "1921", month: "5", day: "5" },
      { kind: "range" as const, year: "300", bce: true, endYear: "1", endBce: false },
    ]) {
      const { value, error } = dateDraftValue(draft(patch));
      expect(error).toBeNull();
      expect(catalogueDateSchema.safeParse(value).success).toBe(true);
      expect(dateDraftValue(dateDraft(value)).value).toEqual(value);
    }
  });

  it("prints a date to the precision it was recorded with", () => {
    const text = (input: unknown) => catalogueDateText(catalogueDateSchema.parse(input));
    expect(text({ precision: "day", start: { year: 2019, month: 5, day: 3 } })).toBe("May 3, 2019");
    expect(text({ precision: "month", start: { year: 2019, month: 5 } })).toBe("May 2019");
    expect(text({ precision: "year", start: { year: 1925 }, approximate: true })).toBe("c. 1925");
    expect(text({ precision: "range", start: { year: 1920 }, end: { year: 1929 } })).toBe("1920–1929");
    expect(text({ precision: "year", start: { year: -44 } })).toBe("44 BC");
    expect(text({ precision: "unknown" })).toBe("Unknown");
    expect(text({ precision: "year", start: { year: 1921 }, label: "Spring 1921" })).toBe("Spring 1921");
    expect(catalogueDateText(null)).toBeNull();
  });
});
