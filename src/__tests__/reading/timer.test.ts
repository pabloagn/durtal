import { describe, expect, it } from "vitest";
import { readingDay } from "@/lib/reading/dates";
import {
  MAX_SESSION_MESSAGE,
  clockText,
  durationSpoken,
  durationWords,
  elapsedSeconds,
  isForgotten,
  shouldAsk,
  stopProblem,
  stopTimes,
  suggestedStop,
} from "@/lib/reading/timer";

/* The timer's arithmetic (SLN-451) and the reading day at every start hour. */

const now = new Date("2026-10-05T20:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("elapsed time", () => {
  it("leaves pauses out and stands still while paused", () => {
    expect(elapsedSeconds({ startedAt: minutesAgo(30), pausedAt: null, pausedSeconds: 300 }, now)).toBe(25 * 60);
    expect(elapsedSeconds({ startedAt: minutesAgo(30), pausedAt: minutesAgo(10), pausedSeconds: 0 }, now)).toBe(20 * 60);
    expect(clockText(12 * 60 + 4)).toBe("12:04");
    expect(clockText(3723)).toBe("1:02:03");
    expect(durationWords(372 * 60)).toBe("6 h 12 min");
    expect(durationSpoken(12 * 60)).toBe("12 minutes");
    expect(durationSpoken(65 * 60)).toBe("1 hour 5 minutes");
  });
});

describe("a forgotten timer", () => {
  it("asks after the check time and needs an end time after twice that", () => {
    expect(shouldAsk(89 * 60, 90)).toBe(false);
    expect(shouldAsk(90 * 60, 90)).toBe(true);
    expect(isForgotten(180 * 60, 90)).toBe(false);
    expect(isForgotten(180 * 60 + 1, 90)).toBe(true);
    const t = { startedAt: minutesAgo(372), pausedAt: null, pausedSeconds: 600, title: "Nadja" };
    expect(stopProblem(t, null, 90, now)).toBe("Your timer for Nadja has run 6 h 2 min. When did you stop?");
    // Stopped at: the start, the check time and the time paused
    expect(suggestedStop(t, 90, now).toISOString()).toBe(new Date(minutesAgo(372).getTime() + 100 * 60_000).toISOString());
  });
});

describe("stopping", () => {
  it("ends at the time given, else the pause, else now", () => {
    const t = { startedAt: minutesAgo(60), pausedAt: minutesAgo(20), pausedSeconds: 0 };
    expect(stopTimes(t, null, now)).toMatchObject({ durationSeconds: 40 * 60, endedAt: minutesAgo(20) });
    expect(stopTimes(t, minutesAgo(10), now)).toMatchObject({ durationSeconds: 40 * 60, pausedSeconds: 10 * 60 });
    expect(stopTimes({ ...t, pausedAt: null }, minutesAgo(50), now).durationSeconds).toBe(10 * 60);
  });
  it("refuses more than 12 hours, an end before the start and one in the future", () => {
    const t = { startedAt: minutesAgo(13 * 60), pausedAt: null, pausedSeconds: 0, title: "Nadja" };
    expect(stopProblem(t, minutesAgo(5), 9999, now)).toBe(MAX_SESSION_MESSAGE);
    expect(stopProblem(t, minutesAgo(14 * 60), 90, now)).toBe("The end time is before the timer started");
    expect(stopProblem(t, new Date(now.getTime() + 5 * 60_000), 90, now)).toBe("The end time is in the future");
    expect(stopProblem({ ...t, startedAt: minutesAgo(30) }, null, 90, now)).toBeNull();
  });
});

describe("the reading day", () => {
  it("starts at each hour from midnight to 06:00", () => {
    // 03:30 in Amsterdam on 5 Oct
    const at = new Date("2026-10-05T01:30:00Z");
    expect([0, 1, 2, 3, 4, 5, 6].map((h) => readingDay(at, "Europe/Amsterdam", h))).toEqual([
      "2026-10-05",
      "2026-10-05",
      "2026-10-05",
      "2026-10-05",
      "2026-10-04",
      "2026-10-04",
      "2026-10-04",
    ]);
  });
});
