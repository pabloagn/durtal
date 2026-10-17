import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FUTURE_READING_DATE, readingDateError, readingDateLimit } from "@/lib/reading/dates";
import {
  abandonReadingSchema, abandonReadingSchemaFor, addPastReadingSchema, createReadingSchema,
  finishReadingSchema, finishReadingSchemaFor, startReadingSchema,
} from "@/lib/validations/reading";

const id = "00000000-0000-4000-8000-000000000001";
const fingerprint = "a".repeat(32);
const at = new Date("2026-10-16T00:30:00Z");

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at); });
afterEach(() => vi.useRealTimers());

describe("reading date limits", () => {
  it.each([
    ["America/Los_Angeles", "2026-10-15"],
    ["Europe/London", "2026-10-16"],
    ["Europe/Amsterdam", "2026-10-16"],
  ])("accepts local today in every entry schema: %s", (timeZone, today) => {
    expect(readingDateLimit(timeZone)).toBe(today);
    expect(startReadingSchema.safeParse({ workId: id, startedOn: today, startedPrecision: "day", timeZone }).success).toBe(true);
    expect(createReadingSchema.safeParse({ workId: id, startedOn: today, startedPrecision: "day", timeZone }).success).toBe(true);
    expect(finishReadingSchema.safeParse({ readingId: id, fingerprint, finishedOn: today, finishedPrecision: "day", timeZone }).success).toBe(true);
    expect(abandonReadingSchema.safeParse({ readingId: id, fingerprint, stoppedOn: today, stoppedPrecision: "day", reason: "lost_interest", timeZone }).success).toBe(true);
    expect(addPastReadingSchema.safeParse({ workId: id, format: "print", status: "finished", startedOn: null, startedPrecision: "unknown", finishedOn: today, finishedPrecision: "day", timeZone }).success).toBe(true);
  });

  it.each(["America/Los_Angeles", "Europe/London", "Europe/Amsterdam"])("refuses future dates in every entry schema: %s", (timeZone) => {
    const future = "2031-05-01";
    const results = [
      startReadingSchema.safeParse({ workId: id, startedOn: future, startedPrecision: "day", timeZone }),
      createReadingSchema.safeParse({ workId: id, startedOn: future, startedPrecision: "day", timeZone }),
      finishReadingSchema.safeParse({ readingId: id, fingerprint, finishedOn: future, finishedPrecision: "day", timeZone }),
      abandonReadingSchema.safeParse({ readingId: id, fingerprint, stoppedOn: future, stoppedPrecision: "day", reason: "lost_interest", timeZone }),
      addPastReadingSchema.safeParse({ workId: id, format: "print", status: "finished", startedOn: null, startedPrecision: "unknown", finishedOn: future, finishedPrecision: "day", timeZone }),
      addPastReadingSchema.safeParse({ workId: id, format: "print", status: "finished", startedOn: future, startedPrecision: "day", finishedOn: null, finishedPrecision: "unknown", timeZone }),
    ];
    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.message === FUTURE_READING_DATE)).toBe(true);
    }
  });

  it("accepts current partial periods, but refuses periods that have not started", () => {
    const base = { workId: id, timeZone: "America/Los_Angeles" };
    for (const [startedPrecision, accepted, refused] of [
      ["month", "2026-10-01", "2026-11-01"],
      ["year", "2026-01-01", "2027-01-01"],
    ]) {
      expect(startReadingSchema.safeParse({ ...base, startedOn: accepted, startedPrecision }).success).toBe(true);
      expect(startReadingSchema.safeParse({ ...base, startedOn: refused, startedPrecision }).success).toBe(false);
    }
    expect(readingDateError("2026-10-31", "month", "2026-10-15")).toBeNull();
    expect(readingDateError(null, "unknown", "2026-10-15")).toBeNull();
  });

  it("permits a trusted start recorded eastward while refusing arbitrary future dates", () => {
    const timeZone = "America/Los_Angeles";
    const input = { readingId: id, fingerprint, finishedOn: "2026-10-16", finishedPrecision: "day", timeZone };
    expect(finishReadingSchema.safeParse(input).success).toBe(false);
    expect(finishReadingSchemaFor("2026-10-16").safeParse(input).success).toBe(true);
    expect(abandonReadingSchemaFor("2026-10-16").safeParse({ readingId: id, fingerprint, stoppedOn: "2026-10-16", stoppedPrecision: "day", reason: "lost_interest", timeZone }).success).toBe(true);
    expect(finishReadingSchemaFor("2026-10-16").safeParse({ ...input, finishedOn: "2026-10-17" }).success).toBe(false);
    expect(finishReadingSchemaFor("2031-05-01").safeParse({ ...input, finishedOn: "2031-05-01" }).success).toBe(false);
    // A payload cannot supply the trusted stored-start context.
    expect(finishReadingSchema.safeParse({ ...input, existingStart: "2026-10-16" }).success).toBe(false);
  });
});
