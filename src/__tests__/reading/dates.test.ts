import { describe, expect, it } from "vitest";
import {
  daysToFinish,
  formatReadingDate,
  formatReadingSpan,
  isTimeZone,
  readingDay,
  readingPeriodEnd,
} from "@/lib/reading/dates";
import { finishAfterStart } from "@/lib/validations/reading";
import { addPastReadingSchema } from "@/lib/validations/reading";
import { canTransition, READING_TRANSITIONS, formatOfCopy } from "@/lib/reading/constants";

describe("readingDay", () => {
  it("counts the hours before 04:00 for the evening before", () => {
    expect(readingDay(new Date("2026-10-04T01:30:00+02:00"), "Europe/Amsterdam", 4)).toBe("2026-10-03");
    expect(readingDay(new Date("2026-10-04T03:59:00+02:00"), "Europe/Amsterdam", 4)).toBe("2026-10-03");
    expect(readingDay(new Date("2026-10-04T04:00:00+02:00"), "Europe/Amsterdam", 4)).toBe("2026-10-04");
  });
  it("follows the local clock across daylight-saving changes in Amsterdam", () => {
    // 29 Mar 2026: 02:00 becomes 03:00; 03:30 local is still before 04:00
    expect(readingDay(new Date("2026-03-29T01:30:00Z"), "Europe/Amsterdam", 4)).toBe("2026-03-28");
    expect(readingDay(new Date("2026-03-29T02:30:00Z"), "Europe/Amsterdam", 4)).toBe("2026-03-29");
    // 25 Oct 2026: 03:00 becomes 02:00; 03:30 local, both times, is before 04:00
    expect(readingDay(new Date("2026-10-25T00:30:00Z"), "Europe/Amsterdam", 4)).toBe("2026-10-24");
    expect(readingDay(new Date("2026-10-25T01:30:00Z"), "Europe/Amsterdam", 4)).toBe("2026-10-24");
    expect(readingDay(new Date("2026-10-25T03:00:00Z"), "Europe/Amsterdam", 4)).toBe("2026-10-25");
  });
  it("uses the zone, not the server's clock", () => {
    // 21:30 in Mexico City on 3 March is 03:30 UTC on 4 March
    expect(readingDay(new Date("2026-03-04T03:30:00Z"), "America/Mexico_City", 4)).toBe("2026-03-03");
    expect(readingDay(new Date("2026-03-04T03:30:00Z"), "UTC", 4)).toBe("2026-03-03");
    expect(readingDay(new Date("2026-03-04T07:30:00Z"), "America/Mexico_City", 4)).toBe("2026-03-03");
    expect(readingDay(new Date("2026-03-04T12:00:00Z"), "UTC", 0)).toBe("2026-03-04");
  });
  it("knows a time zone", () => {
    expect(isTimeZone("America/Mexico_City")).toBe(true);
    expect(isTimeZone("Mars/Base")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("imprecise dates", () => {
  it("ends a period on its last day", () => {
    expect(readingPeriodEnd("2019-04-14", "day")).toBe("2019-04-14");
    expect(readingPeriodEnd("2019-04-01", "month")).toBe("2019-04-30");
    expect(readingPeriodEnd("2024-02-01", "month")).toBe("2024-02-29");
    expect(readingPeriodEnd("2019-01-01", "year")).toBe("2019-12-31");
  });
  it("accepts a finish period that ends on or after the start", () => {
    const start = { startedOn: "2019-04-14", startedPrecision: "day" };
    expect(finishAfterStart({ ...start, finishedOn: "2019-04-01", finishedPrecision: "month" })).toBe(true);
    expect(finishAfterStart({ ...start, finishedOn: "2019-01-01", finishedPrecision: "year" })).toBe(true);
    expect(finishAfterStart({ ...start, finishedOn: "2019-03-01", finishedPrecision: "month" })).toBe(false);
    const row = { workId: "00000000-0000-4000-8000-000000000001", format: "print", status: "finished", ...start, finishedPrecision: "month" };
    expect(addPastReadingSchema.safeParse({ ...row, finishedOn: "2019-03-01" }).error?.issues[0].message).toBe(
      "The finish date is before the start date",
    );
    expect(addPastReadingSchema.safeParse({ ...row, finishedOn: "2019-04-01" }).success).toBe(true);
  });
  it("writes dates at their precision", () => {
    expect(formatReadingDate("2019-04-14", "day")).toBe("14 Apr 2019");
    expect(formatReadingDate("2019-04-01", "month")).toBe("Apr 2019");
    expect(formatReadingDate("2019-01-01", "year")).toBe("2019");
    expect(formatReadingDate(null, "unknown")).toBe("Date unknown");
  });
  it("writes spans", () => {
    const today = "2026-10-04";
    const r = { status: "finished" as const, startedOn: "2019-04-03", startedPrecision: "day" as const, finishedOn: "2019-04-14", finishedPrecision: "day" as const };
    expect(formatReadingSpan(r, today)).toBe("3 to 14 Apr 2019");
    expect(formatReadingSpan({ ...r, startedOn: "2019-03-01", startedPrecision: "month" }, today)).toBe("Mar to 14 Apr 2019");
    expect(formatReadingSpan({ ...r, startedOn: null, startedPrecision: "unknown", finishedOn: "2009-01-01", finishedPrecision: "year" }, today)).toBe("Finished 2009");
    expect(
      formatReadingSpan({ status: "reading", startedOn: "2026-10-02", startedPrecision: "day", finishedOn: null, finishedPrecision: "unknown" }, today),
    ).toBe("Started 2 Oct");
    expect(formatReadingSpan({ ...r, startedOn: null, startedPrecision: "unknown", finishedOn: null, finishedPrecision: "unknown" }, today)).toBe("Dates unknown");
  });
  it("says a shared year once, and keeps both years across years (SLN-1097)", () => {
    const today = "2026-10-18";
    const span = (startedOn: string, startedPrecision: "day" | "month", finishedOn: string, finishedPrecision: "day" | "month") =>
      formatReadingSpan({ status: "finished", startedOn, startedPrecision, finishedOn, finishedPrecision }, today);
    expect(span("2026-04-01", "month", "2026-05-01", "month")).toBe("Apr to May 2026");
    expect(span("2026-04-03", "day", "2026-05-01", "month")).toBe("3 Apr to May 2026");
    expect(span("2026-04-03", "day", "2026-05-14", "day")).toBe("3 Apr to 14 May 2026");
    expect(span("2025-11-01", "month", "2026-02-01", "month")).toBe("Nov 2025 to Feb 2026");
    expect(span("2025-12-30", "day", "2026-01-02", "day")).toBe("30 Dec 2025 to 2 Jan 2026");
  });
  it("writes one date when a span starts and ends in the same period (SLN-929)", () => {
    const today = "2026-10-16";
    const span = (startedOn: string, startedPrecision: "day" | "month" | "year", finishedOn: string, finishedPrecision: "day" | "month" | "year", status: "finished" | "abandoned" = "finished") =>
      formatReadingSpan({ status, startedOn, startedPrecision, finishedOn, finishedPrecision }, today);
    expect(span("2026-10-16", "day", "2026-10-16", "day")).toBe("16 Oct 2026");
    expect(span("2026-10-01", "month", "2026-10-01", "month")).toBe("Oct 2026");
    expect(span("2019-01-01", "year", "2019-01-01", "year")).toBe("2019");
    expect(span("2020-05-01", "month", "2020-01-01", "year")).toBe("Finished 2020, started May");
    expect(span("2020-05-03", "day", "2020-01-01", "year", "abandoned")).toBe("Stopped 2020, started 3 May");
    expect(span("2021-01-01", "year", "2021-02-01", "month")).toBe("Finished Feb 2021");
    expect(span("2019-04-01", "month", "2019-04-14", "day")).toBe("Finished 14 Apr 2019");
    // Different periods keep their span
    expect(span("2026-10-15", "day", "2026-10-16", "day")).toBe("15 to 16 Oct 2026");
    expect(span("2019-01-01", "year", "2020-01-01", "year")).toBe("2019 to 2020");
    expect(span("2020-05-01", "month", "2021-01-01", "year")).toBe("May 2020 to 2021");
  });
  it("leaves the outcome word out when the line names it after (SLN-1098)", () => {
    const today = "2026-10-18";
    const bare = (status: "finished" | "abandoned", startedOn: string | null, startedPrecision: "unknown" | "day" | "month" | "year", finishedOn: string, finishedPrecision: "day" | "month" | "year") =>
      formatReadingSpan({ status, startedOn, startedPrecision, finishedOn, finishedPrecision }, today, { bare: true });
    expect(bare("finished", null, "unknown", "2024-11-27", "day")).toBe("27 Nov 2024");
    expect(bare("abandoned", null, "unknown", "2024-11-27", "day")).toBe("27 Nov 2024");
    expect(bare("finished", "2021-01-01", "year", "2021-02-01", "month")).toBe("Feb 2021");
    expect(bare("abandoned", "2020-05-03", "day", "2020-01-01", "year")).toBe("2020, started 3 May");
    expect(bare("finished", "2019-04-03", "day", "2019-04-14", "day")).toBe("3 to 14 Apr 2019");
  });
  it("counts days to finish only between two exact days", () => {
    expect(daysToFinish({ startedOn: "2019-04-03", startedPrecision: "day", finishedOn: "2019-04-14", finishedPrecision: "day" })).toBe(12);
    expect(daysToFinish({ startedOn: "2019-04-01", startedPrecision: "month", finishedOn: "2019-04-14", finishedPrecision: "day" })).toBeNull();
  });
});

describe("READING_TRANSITIONS", () => {
  it("allows only the documented status changes", () => {
    expect(canTransition(null, "reading")).toBe(true);
    expect(canTransition(null, "finished")).toBe(true);
    expect(canTransition("reading", "paused")).toBe(true);
    expect(canTransition("paused", "reading")).toBe(true);
    expect(canTransition("reading", "finished")).toBe(true);
    expect(canTransition("paused", "abandoned")).toBe(true);
    expect(canTransition("finished", "reading")).toBe(true);
    expect(canTransition("abandoned", "paused")).toBe(true);
    expect(canTransition("finished", "abandoned")).toBe(false);
    expect(canTransition("reading", "reading")).toBe(false);
    expect(canTransition("paused", "paused")).toBe(false);
    expect(READING_TRANSITIONS).toHaveLength(5);
  });
  it("reads a copy's format", () => {
    expect(formatOfCopy("epub")).toBe("ebook");
    expect(formatOfCopy("pdf")).toBe("ebook");
    expect(formatOfCopy("audiobook")).toBe("audio");
    expect(formatOfCopy("hardcover")).toBe("print");
    expect(formatOfCopy(null)).toBe("print");
  });
});
