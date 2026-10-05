import { describe, expect, it } from "vitest";
import { readingDay } from "@/lib/reading/dates";
import {
  NEVER_SAID,
  addDays,
  dayOfYear,
  expectedShare,
  goalLine,
  goalShortLine,
  goalTitle,
  pastGoalText,
  projection,
  reachedText,
  rhythmRange,
  rhythmView,
  weekDays,
  weekStartOf,
  type GoalState,
} from "@/lib/reading/goals";

/* Goals and the weekly rhythm's pure rules (SLN-455). */

const goal = (over: Partial<GoalState>): GoalState => ({ metric: "books", year: 2026, target: 30, count: 0, reachedOn: null, reachedPrecision: null, ...over });

describe("goal words", () => {
  it("says where a goal stands, neutrally", () => {
    // 1 July: about half the year gone
    expect(goalLine(goal({ count: 15 }), "2026-07-02")).toBe("On pace");
    expect(goalLine(goal({ count: 18 }), "2026-07-02")).toBe("2 books ahead");
    expect(goalLine(goal({ count: 12 }), "2026-10-05")).toBe("18 to go: about one every 5 days from now");
    expect(goalLine(goal({ count: 2 }), "2026-03-01")).toBe("28 to go: about one every 11 days from now");
    expect(goalLine(goal({ count: 0 }), "2026-01-01")).toBe("On pace");
    expect(goalLine(goal({ target: 12, count: 0 }), "2026-03-01")).toBe("12 to go: about one every 4 weeks from now");
    expect(goalLine(goal({ metric: "pages", target: 10_000, count: 4000 }), "2026-10-05")).toBe("6,000 to go: about 68 pages a day from now");
    expect(goalLine(goal({ metric: "hours", target: 100, count: 40 }), "2026-10-05")).toBe("60 to go: about 41 minutes a day from now");
    expect(goalTitle("books", 12, 30)).toBe("12 of 30 books");
    expect(goalTitle("hours", 2.46, 100)).toBe("2.5 of 100 hours");
    expect(goalShortLine(goal({ count: 12 }), "2026-10-05")).toBe("18 to go");
    expect(goalShortLine(goal({ count: 30 }), "2026-10-05")).toBe("goal reached");
  });

  it("never says behind, streak, lost or fail, on any day of the year, at any count", () => {
    const words = new Set<string>();
    for (const metric of ["books", "pages", "hours"] as const)
      for (let day = 0; day < 366; day += 5)
        for (let count = 0; count <= 32; count += 2) {
          const today = addDays("2026-01-01", day);
          words.add(goalLine(goal({ metric, count }), today));
          words.add(goalShortLine(goal({ metric, count }), today));
        }
    for (const day of ["2026-01-01", "2026-12-31"]) words.add(goalLine(goal({ count: 0 }), day));
    const text = [...words].join(" | ").toLowerCase();
    for (const word of NEVER_SAID) expect(text).not.toContain(word);
    expect(goalLine(goal({ count: 3 }), "2026-12-31")).toBe("27 to go: about 27 a day from now");
  });

  it("says when a goal was reached, at its precision", () => {
    expect(reachedText("2026-10-14", "day")).toBe("Goal reached on 14 Oct");
    expect(reachedText("2026-10-01", "month")).toBe("Goal reached in October");
    expect(reachedText("2026-01-01", "year")).toBe("Goal reached in 2026");
    expect(goalLine(goal({ count: 31, reachedOn: "2026-10-14", reachedPrecision: "day" }), "2026-11-01")).toBe("Goal reached on 14 Oct");
    expect(pastGoalText({ metric: "books", year: 2025, target: 30, count: 28 })).toBe("28 of 30 books in 2025");
  });

  it("measures the year and projects the pace of the last 90 days", () => {
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(dayOfYear("2024-12-31")).toBe(366);
    expect(expectedShare(2026, "2025-12-31")).toBe(0);
    expect(expectedShare(2026, "2027-01-01")).toBe(1);
    // 9 in the last 90 days, 87 days left after 5 Oct: about 8.7 more
    expect(Math.round(projection(goal({ count: 18 }), 9, "2026-10-05"))).toBe(27);
  });
});

describe("the week", () => {
  it("starts on Monday or Sunday", () => {
    expect(weekStartOf("2026-10-07", 1)).toBe("2026-10-05");
    expect(weekStartOf("2026-10-07", 7)).toBe("2026-10-04");
    expect(weekDays("2026-10-04", 7)[0]).toBe("2026-10-04");
  });

  it("takes today from the browser: 22:00 on a Sunday in Mexico City is Sunday, in this week, though it is Monday in Amsterdam", () => {
    const at = new Date("2026-10-05T04:00:00Z");
    expect(readingDay(at, "Europe/Amsterdam", 4)).toBe("2026-10-05");
    const today = readingDay(at, "America/Mexico_City", 4);
    expect(today).toBe("2026-10-04");
    const view = rhythmView(["2026-09-29", "2026-10-04"], today, 1, 5);
    expect(view.week.map((d) => d.day)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(view.week.at(-1)).toMatchObject({ day: "2026-10-04", today: true, read: true, label: "Sunday" });
    expect(view.thisWeek).toBe(2);
  });

  it("counts the 12 weeks before this one, kept when they reach the target", () => {
    const today = "2026-10-07";
    const start = weekStartOf(today, 1);
    // Last week: 5 days; the week before: 4
    const days = [1, 2, 3, 4, 5].map((i) => addDays(start, -7 + i - 1)).concat([1, 2, 3, 4].map((i) => addDays(start, -14 + i - 1)));
    const view = rhythmView(days, today, 1, 5);
    expect(view.weeks).toHaveLength(12);
    expect(view.weeks.slice(-2).map((w) => [w.days, w.kept])).toEqual([
      [4, false],
      [5, true],
    ]);
    expect(view.kept).toBe(1);
  });

  it("sends every day a browser a day behind or ahead of the server reads (PR #109 review)", () => {
    // Sunday 21:30 in Mexico City is Monday in Amsterdam: the browser's week is the one before the server's
    const missing: string[] = [];
    for (let i = 0; i < 14; i++) {
      const server = addDays("2026-10-01", i);
      for (const weekStart of [1, 7] as const) {
        const { from, to } = rhythmRange(server, weekStart);
        for (const browser of [addDays(server, -1), addDays(server, 1)]) {
          const view = rhythmView([], browser, weekStart, 5);
          const read = [...view.weeks.flatMap((w) => Array.from({ length: 7 }, (_, d) => addDays(w.start, d))), ...view.week.filter((d) => d.day <= browser).map((d) => d.day)];
          for (const day of read) if (day < from || day > to) missing.push(`${day} for server ${server} / browser ${browser}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
