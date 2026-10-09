import { describe, expect, it } from "vitest";
import { fractionToPercent, cutChapter, isReaderEnd } from "@/lib/reading/reader-progress";
import { proposeEbookReading, type LegacyReaderHistory, type BackfillContext } from "@/lib/reading/ebook-backfill";
import { writeReadingRowSchema } from "@/lib/validations/reading";

const context: BackfillContext = {
  ebookId: "00000000-0000-4000-a000-000000000001", workId: "00000000-0000-4000-a000-000000000002",
  editionId: "00000000-0000-4000-a000-000000000003", instanceId: "00000000-0000-4000-a000-000000000004",
  totalPages: 400, now: new Date("2026-10-09T12:00:00Z"), timeZone: "Europe/Amsterdam", dayStartHour: 4, hasOpenReading: false,
};
const history: LegacyReaderHistory = {
  progressPercent: 0.44, startedAt: new Date("2026-09-01T12:00:00Z"),
  lastReadAt: new Date("2026-09-29T12:00:00Z"), finishedAt: null,
};

describe("legacy reader proposal", () => {
  it.each([[0.44, 44], [0.995, 99.5], [Math.fround(0.995), 99.5], [0.994, 99.4], [0, 0]])("converts fraction %s to %s", (fraction, percent) => {
    expect(fractionToPercent(fraction)).toBe(percent);
    expect(isReaderEnd(percent)).toBe(percent >= 99.5);
  });
  it("refuses corrupt fractions and cuts chapters at database character boundaries", () => {
    for (const value of [-1, 1.1, NaN, Infinity]) expect(() => fractionToPercent(value)).toThrow();
    expect(cutChapter("x".repeat(450))).toHaveLength(300);
    expect(Array.from(cutChapter("𐐀".repeat(450))!)).toHaveLength(300);
    expect(cutChapter("  ")).toBeNull();
  });
  it("proposes a selected recent reading at the start and current percent", () => {
    const result = proposeEbookReading(history, context);
    expect(result).toMatchObject({ selected: true, reason: "recent", canImport: true,
      reading: { status: "reading", position: { percent: 44 }, unit: "percent", totalPages: 400,
        sourceKey: `reader:${context.ebookId}`, finishedPrecision: "unknown" } });
    expect(writeReadingRowSchema.safeParse(result.reading).success).toBe(true);
  });
  it("selects an explicit finish at any fraction and uses reading days", () => {
    const result = proposeEbookReading({ ...history, progressPercent: 0.2,
      finishedAt: new Date("2026-10-09T00:00:00Z") }, context);
    expect(result).toMatchObject({ selected: true, reading: { status: "finished", finishedOn: "2026-10-08", finishedPrecision: "day" } });
  });
  it("does not invent a finish from last-open time at the end", () => {
    const result = proposeEbookReading({ ...history, progressPercent: Math.fround(0.995) }, context);
    expect(result).toMatchObject({ selected: false, reason: "end_without_finish",
      reading: { status: "finished", finishedOn: null, finishedPrecision: "unknown" } });
  });
  it("pauses at the thirty-day boundary and selects intermediate history", () => {
    const lastReadAt = new Date(context.now.getTime() - 30 * 86_400_000);
    expect(proposeEbookReading({ ...history, lastReadAt }, context)).toMatchObject({ selected: true, reason: "paused", reading: { status: "paused" } });
  });
  it.each([
    { ...history, progressPercent: 0.02 },
    { ...history, lastReadAt: new Date("2024-10-09T12:00:00Z") },
    { ...history, lastReadAt: null },
    { ...history, progressPercent: null },
  ])("leaves low or old open history unticked", (input) => {
    expect(proposeEbookReading(input, context)).toMatchObject({ selected: false, reason: "low_or_old", reading: { status: "paused" } });
  });
  it("blocks an open proposal but allows a historical finished read when another reading is open", () => {
    expect(proposeEbookReading(history, { ...context, hasOpenReading: true })).toMatchObject({ selected: false, canImport: false, reason: "already_open" });
    expect(proposeEbookReading({ ...history, finishedAt: context.now }, { ...context, hasOpenReading: true }).canImport).toBe(true);
  });
  it("preserves unknown starts and respects the calendar-year boundary", () => {
    const boundary = new Date("2025-10-09T12:00:00Z");
    expect(proposeEbookReading({ ...history, startedAt: null, lastReadAt: boundary }, context)).toMatchObject({ selected: true,
      reading: { startedOn: null, startedPrecision: "unknown", status: "paused" } });
  });
});
