import { describe, expect, it } from "vitest";
import {
  barsFit,
  calendarBlocks,
  calendarCells,
  dayLabel,
  durationWords,
  finishText,
  minutesLabel,
  moveFocus,
  niceMax,
  parseStatsYear,
  peakWords,
  shade,
  ticks,
  yearRhythm,
} from "@/lib/reading/charts";
import { MIN_GROUP, insights, meaningful } from "@/lib/reading/insights";
import type { InsightInputs } from "@/lib/reading/stats";

/* The reading charts' and insights' pure rules (SLN-456). */

describe("scales", () => {
  it("rounds the top up to 1, 2, 2.5 or 5 times a power of ten, never to a fraction", () => {
    expect([0, -3, Number.NaN, 0.4, 1, 2.2, 7, 12, 21, 45, 100, 101, 1_210].map(niceMax)).toEqual([1, 1, 1, 1, 1, 5, 10, 20, 25, 50, 100, 200, 2_000]);
  });

  it("puts whole ticks from 0 to the top, ending on it", () => {
    expect(ticks(0)).toEqual([0, 1]);
    expect(ticks(2)).toEqual([0, 1, 2]);
    expect(ticks(7)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks(12)).toEqual([0, 5, 10, 15, 20]);
    expect(ticks(21)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(ticks(45)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(ticks(90)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks(1_210)).toEqual([0, 500, 1_000, 1_500, 2_000]);
    for (const max of [1, 3, 9, 33, 480, 7_777]) {
      const t = ticks(max);
      expect(t.at(-1)).toBe(niceMax(max));
      expect(t.every(Number.isInteger)).toBe(true);
      expect(t.length).toBeLessThanOrEqual(6);
    }
  });

  it("stands bars side by side only when their labels fit (PR #110 review)", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "?"];
    expect([barsFit(534, months), barsFit(480, months)]).toEqual([true, true]);
    expect(barsFit(534, ["Under 150", "150 to 299", "300 to 499", "500 to 799", "800 or more"])).toBe(true);
    const decades = Array.from({ length: 37 }, (_, i) => `${1610 + i * 10}s`);
    expect([barsFit(1100, decades), barsFit(1100, decades.slice(0, 12))]).toEqual([false, true]);
    expect(barsFit(300, [])).toBe(true);
  });

  it("shades a day from 0 to 4 against the busiest day", () => {
    expect([0, 1, 25, 26, 50, 75, 100, 140].map((v) => shade(v, 100))).toEqual([0, 1, 1, 2, 2, 3, 4, 4]);
    expect(shade(10, 0)).toBe(0);
  });
});

describe("the calendar", () => {
  it("lays a leap year in Monday weeks: 366 days, 1 January on a Monday, 53 rows", () => {
    const cells = calendarCells(2024, 1);
    expect(cells).toHaveLength(366);
    expect(cells[0]).toEqual({ day: "2024-01-01", index: 0, column: 0, row: 0 });
    expect(cells.find((c) => c.day === "2024-02-29")).toEqual({ day: "2024-02-29", index: 59, column: 3, row: 8 });
    expect(cells.at(-1)).toEqual({ day: "2024-12-31", index: 365, column: 1, row: 52 });
  });

  it("lays the same year in Sunday weeks", () => {
    const cells = calendarCells(2024, 7);
    expect(cells[0]).toEqual({ day: "2024-01-01", index: 0, column: 1, row: 0 });
    expect(cells.find((c) => c.day === "2024-01-07")).toMatchObject({ column: 0, row: 1 });
    expect(cells.at(-1)).toEqual({ day: "2024-12-31", index: 365, column: 2, row: 52 });
  });

  it("starts a year on its weekday and leaves the next year's days out", () => {
    // 1 January 2026 is a Thursday
    expect(calendarCells(2026, 1)[0]).toMatchObject({ column: 3, row: 0 });
    expect(calendarCells(2026, 7)[0]).toMatchObject({ column: 4, row: 0 });
    expect(calendarCells(2026, 1)).toHaveLength(365);
    expect(calendarCells(2026, 1).at(-1)).toMatchObject({ day: "2026-12-31", column: 3, row: 52 });
    // Every week row holds at most seven days, each column once
    const cells = calendarCells(2023, 7);
    for (let row = 0; row <= cells.at(-1)!.row; row++) {
      const columns = cells.filter((c) => c.row === row).map((c) => c.column);
      expect(new Set(columns).size).toBe(columns.length);
    }
  });

  it("splits the week rows into four blocks", () => {
    expect(calendarBlocks(53)).toEqual([
      { from: 0, to: 13 },
      { from: 14, to: 27 },
      { from: 28, to: 41 },
      { from: 42, to: 52 },
    ]);
    expect(calendarBlocks(3)).toEqual([
      { from: 0, to: 0 },
      { from: 1, to: 1 },
      { from: 2, to: 2 },
    ]);
  });

  it("counts a year's weeks with reading and those that kept the rhythm", () => {
    const days = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-12", "2026-01-12", "2025-12-31", "2027-01-01"];
    expect(yearRhythm(days, 2026, 1, 3)).toEqual({ weeks: 53, weeksRead: 2, kept: 1 });
    expect(yearRhythm(days, 2026, 1, null)).toEqual({ weeks: 53, weeksRead: 2, kept: null });
  });
});

describe("the keyboard", () => {
  it("moves the focus point by one, by a week, and to the ends, never out of the chart", () => {
    expect(moveFocus(null, "ArrowRight", 12)).toBe(0);
    expect(moveFocus(null, "ArrowDown", 365, 7)).toBe(0);
    expect(moveFocus(3, "ArrowRight", 12)).toBe(4);
    expect(moveFocus(3, "ArrowLeft", 12)).toBe(2);
    expect(moveFocus(0, "ArrowLeft", 12)).toBe(0);
    expect(moveFocus(11, "ArrowRight", 12)).toBe(11);
    expect(moveFocus(3, "ArrowDown", 365, 7)).toBe(10);
    expect(moveFocus(10, "ArrowUp", 365, 7)).toBe(3);
    expect(moveFocus(2, "ArrowUp", 365, 7)).toBe(0);
    expect(moveFocus(360, "ArrowDown", 365, 7)).toBe(364);
    expect(moveFocus(5, "Home", 12)).toBe(0);
    expect(moveFocus(null, "End", 12)).toBe(11);
    expect(moveFocus(5, "Enter", 12)).toBeNull();
    expect(moveFocus(null, "ArrowRight", 0)).toBeNull();
  });
});

describe("labels and the year", () => {
  it("writes fixed English labels", () => {
    expect(dayLabel("2026-02-03")).toBe("3 Feb 2026");
    expect([45, 60, 80, 1_210].map(minutesLabel)).toEqual(["45 min", "1 h", "1 h 20 min", "20 h 10 min"]);
    expect([1, 12, 59, 240, 1_169].map(durationWords)).toEqual(["1 day", "12 days", "59 days", "8 months", "3.2 years"]);
    expect([365, 400].map(durationWords)).toEqual(["1 year", "1.1 years"]);
    expect(peakWords({ weekday: 7, part: "evening" })).toBe("Sunday evenings");
    expect(peakWords(null)).toBeNull();
    expect([finishText("2026-01-03", "day"), finishText("2026-03-01", "month"), finishText("2026-01-01", "year")]).toEqual(["3 Jan", "March", "2026"]);
  });

  it("reads ?year=: a year with readings, all for all time, anything else the default", () => {
    const years = [2026, 2025, 2019];
    expect(parseStatsYear("2025", years, 2026)).toBe(2025);
    expect(parseStatsYear("all", years, 2026)).toBeNull();
    expect(parseStatsYear(["2019", "2025"], years, 2026)).toBe(2019);
    for (const bad of [undefined, "", "2024", "20250", "2025abc", " 2025", "ALL"]) expect(parseStatsYear(bad, years, 2026)).toBe(2026);
  });
});

describe("insights", () => {
  const group = (count: number, avg: number | null) => ({ count, avg });
  const none = group(0, null);
  const base: InsightInputs = { short: none, long: none, translated: none, original: none, rereads: none, firstReads: none, ownCopy: none, noCopy: none, finished: 0, started: 0 };

  it("speaks only with enough books in each group and a real difference", () => {
    expect(meaningful(group(MIN_GROUP, 4.3), group(MIN_GROUP, 3.7))).toBe(true);
    expect(meaningful(group(MIN_GROUP - 1, 4.3), group(20, 3.7))).toBe(false);
    expect(meaningful(group(20, 4.3), group(MIN_GROUP - 1, 3.7))).toBe(false);
    // 0.4 apart on ratings near 4 is under half a star and under 20%
    expect(meaningful(group(9, 4.2), group(9, 3.8))).toBe(false);
    // 0.4 apart on low ratings is over 20%
    expect(meaningful(group(9, 1.9), group(9, 1.5))).toBe(true);
    expect(meaningful(group(9, null), group(9, 3))).toBe(false);
  });

  it("writes each sentence with its numbers and a link to the evidence", () => {
    const found = insights({ ...base, short: group(12, 4.3), long: group(9, 3.7), finished: 18, started: 20 }, 2025);
    expect(found).toEqual([
      {
        key: "length",
        text: "Your ratings are highest for books under 250 pages (4.3 against 3.7)",
        numbers: "12 rated books under 250 pages, 9 longer ones",
        href: "/reading/journal?yearMin=2025&yearMax=2025&status=finished",
      },
      { key: "finish", text: "You finish 9 of 10 books you start", numbers: "18 finished, 2 abandoned", href: "/reading/journal?yearMin=2025&yearMax=2025&status=finished,abandoned" },
    ]);
    expect(insights({ ...base, translated: group(5, 3.2), original: group(5, 4.4) }, null)).toEqual([
      {
        key: "translation",
        text: "You rate books in their original language higher (4.4 against 3.2)",
        numbers: "5 rated in translation, 5 in the original language",
        href: "/reading/journal?status=finished",
      },
    ]);
  });

  it("says nothing below the minimum group size, and at most six sentences", () => {
    const small = group(MIN_GROUP - 1, 5);
    expect(insights({ ...base, short: small, long: small, translated: small, original: small, rereads: small, firstReads: small, ownCopy: small, noCopy: small, finished: 4, started: 4 }, 2025)).toEqual([]);
    const big = (avg: number) => group(30, avg);
    const all = insights({ ...base, short: big(4.5), long: big(3), translated: big(4.5), original: big(3), rereads: big(4.5), firstReads: big(3), ownCopy: big(4.5), noCopy: big(3), finished: 50, started: 60 }, 2025);
    expect(all.map((i) => i.key)).toEqual(["length", "translation", "rereads", "copies", "finish"]);
    expect(all.length).toBeLessThanOrEqual(6);
  });
});
