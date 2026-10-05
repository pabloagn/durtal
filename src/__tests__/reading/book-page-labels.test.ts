import { describe, expect, it } from "vitest";
import { bookReadingState, ordinalRead, readingControlLabel, readingMenu, readingRecord, type ReadingSummary } from "@/lib/reading/labels";
import { logPreview, moveBackText, type LogReading } from "@/lib/reading/log-preview";
import { catalogueDateOf, readingDateOf } from "@/lib/reading/dates";
import { readingHomes } from "@/lib/reading/page-data";

const base: ReadingSummary = {
  id: "r",
  status: "reading",
  unit: "pages",
  currentPage: 212,
  currentPercent: 44.17,
  currentMinutes: null,
  totalPages: 480,
  totalMinutes: null,
  finishedOn: null,
  finishedPrecision: "unknown",
};
const done = (finishedOn: string, over: Partial<ReadingSummary> = {}): ReadingSummary => ({
  ...base,
  status: "finished",
  finishedOn,
  finishedPrecision: "day",
  ...over,
});

describe("the header control", () => {
  it("names each state", () => {
    expect(readingControlLabel([])).toBe("Start reading");
    expect(readingControlLabel([base])).toBe("Reading · p. 212 of 480 · 44%");
    expect(readingControlLabel([{ ...base, unit: "percent" }])).toBe("Reading · 44%");
    expect(readingControlLabel([{ ...base, unit: "minutes", currentMinutes: 192, totalMinutes: 580 }])).toBe("Reading · 3:12 of 9:40");
    expect(readingControlLabel([{ ...base, status: "paused" }])).toBe("Paused at 44%");
    expect(readingControlLabel([done("2024-04-14")])).toBe("Read · 14 Apr 2024");
    expect(readingControlLabel([{ ...base, status: "abandoned", currentPage: 120 }])).toBe("Abandoned at p. 120");
  });
  it("counts finished readings only for Read N times", () => {
    const rows = [done("2009-01-01"), done("2015-06-01"), { ...base, status: "abandoned" as const }, done("2024-03-02")];
    expect(readingControlLabel(rows)).toBe("Read 3 times · 2024");
    expect(bookReadingState(rows)).toBe("read");
  });
  it("offers the actions that make sense", () => {
    expect(readingMenu("unread")).toEqual(["start", "past"]);
    expect(readingMenu("reading")).toEqual(["progress", "pause", "finish", "abandon", "edit"]);
    expect(readingMenu("paused")).toEqual(["resume", "progress", "finish", "abandon"]);
    expect(readingMenu("read")).toEqual(["reread", "past"]);
    expect(readingMenu("abandoned")).toEqual(["resumeAbandoned", "startAgain", "past"]);
  });
  it("numbers reads", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinalRead)).toEqual([
      "1st read", "2nd read", "3rd read", "4th read", "11th read", "12th read", "13th read", "21st read", "22nd read",
    ]);
  });
});

describe("the log preview", () => {
  const reading: LogReading = { editionId: "e1", unit: "pages", totalPages: 480, totalMinutes: null, currentPage: 178, currentPercent: 37.08, currentMinutes: null };
  it("reads a page and says how far since last time", () => {
    const p = logPreview(reading, { kind: "page", page: 212 })!;
    expect(p.line).toBe("Page 212 of 480 · 44.17% · 34 pages since last time");
    expect(p.send).toEqual({ page: 212 });
    expect(p.behind).toBe(false);
    expect(logPreview(reading, { kind: "addPages", pages: 20 })!.send).toEqual({ addPages: 20 });
  });
  it("sees a move back and the end", () => {
    const back = logPreview({ ...reading, currentPage: 400, currentPercent: 83.33 }, { kind: "page", page: 212 })!;
    expect(back.behind).toBe(true);
    expect(moveBackText({ ...reading, currentPage: 400, currentPercent: 83.33 }, back)).toBe("This moves you back from p. 400 to p. 212");
    expect(logPreview(reading, { kind: "page", page: 480 })!.reachedEnd).toBe(true);
  });
  it("says where the reading moves when a sitting is in another edition", () => {
    const p = logPreview(reading, { kind: "percent", percent: 33 }, { id: "audio", pageCount: null, totalMinutes: 580, unit: "minutes" })!;
    expect(p.line).toBe("33% · the reading moves to p. 158 of 480");
  });
});

describe("partial dates", () => {
  it("stores a month or year as the first day of its period", () => {
    expect(readingDateOf({ precision: "year", start: { year: 2009 } })).toEqual({ date: "2009-01-01", precision: "year" });
    expect(readingDateOf({ precision: "month", start: { year: 2019, month: 4 } })).toEqual({ date: "2019-04-01", precision: "month" });
    expect(readingDateOf({ precision: "day", start: { year: 2019, month: 4, day: 14 } })).toEqual({ date: "2019-04-14", precision: "day" });
    expect(readingDateOf({ precision: "unknown" })).toEqual({ date: null, precision: "unknown" });
    expect(catalogueDateOf("2019-04-01", "month")).toEqual({ precision: "month", start: { year: 2019, month: 4, day: null } });
  });
});

describe("the record group and homes", () => {
  it("sums the readings up", () => {
    const rows = [
      { reading: { status: "finished" as const, startedOn: "2012-03-01", startedPrecision: "month" as const, finishedOn: "2012-04-02", finishedPrecision: "day" as const }, totalSeconds: 3600 },
      { reading: { status: "finished" as const, startedOn: null, startedPrecision: "unknown" as const, finishedOn: "2024-01-01", finishedPrecision: "year" as const }, totalSeconds: 1800 },
      { reading: { status: "abandoned" as const, startedOn: null, startedPrecision: "unknown" as const, finishedOn: null, finishedPrecision: "unknown" as const }, totalSeconds: 0 },
    ];
    expect(readingRecord(rows)).toEqual({ firstRead: "Mar 2012", lastFinished: "2024", timesRead: 2, timeSpent: "1 h 30 min" });
  });
  it("offers only physical, active places", () => {
    expect(
      readingHomes([
        { id: "a", name: "Amsterdam", type: "physical", isActive: true },
        { id: "k", name: "Kindle", type: "digital", isActive: true },
        { id: "o", name: "Old", type: "physical", isActive: false },
      ]),
    ).toEqual([{ id: "a", name: "Amsterdam" }]);
  });
});
