import { describe, expect, it } from "vitest";
import {
  finishEstimate,
  finishText,
  listeningFactor,
  paceExplanation,
  pagesPerHour,
  priorFor,
  readingEstimate,
  timeLeft,
  timeLeftText,
  type PacePriors,
  type PaceReading,
  type PaceSession,
} from "@/lib/reading/pace";

/* Pace and estimates (SLN-451): pure, from getPaceContext's inputs. */

const noPriors: PacePriors = { byLanguageFormat: {}, byFormat: {}, overall: null };
const priors: PacePriors = { byLanguageFormat: { "fr|print": 29 }, byFormat: { print: 35, ebook: 50 }, overall: 40 };
const session = (over: Partial<PaceSession>): PaceSession => ({ readOn: "2026-10-01", durationSeconds: 3600, pages: 30, format: "print", minutesAdvanced: null, ...over });
const reading = (over: Partial<PaceReading>): PaceReading => ({
  readingId: "r",
  format: "print",
  unit: "pages",
  language: "fr",
  totalPages: 400,
  totalMinutes: null,
  currentPercent: 50,
  currentMinutes: null,
  sessions: [],
  pauses: [],
  ...over,
});

describe("the prior", () => {
  it("falls back from language and format, to format, to everything, to 30", () => {
    expect(priorFor(priors, "fr", "print")).toEqual({ value: 29, of: "French print" });
    expect(priorFor(priors, "de", "print")).toEqual({ value: 35, of: "print" });
    expect(priorFor({ ...priors, byFormat: {} }, "de", "print")).toEqual({ value: 40, of: "everything" });
    expect(priorFor(noPriors, "fr", "print")).toEqual({ value: 30, of: null });
  });
});

describe("pages an hour", () => {
  it("blends counted pages over hours with two hours of the prior", () => {
    const r = reading({ sessions: [session({ pages: 60, durationSeconds: 3600 }), session({ pages: 0, durationSeconds: 1800 }), session({ pages: 40, durationSeconds: null }), session({ format: "audio", pages: 30 })] });
    const pace = pagesPerHour(r, priors);
    // (60 + 2 × 29) / (1 + 2): the session without pages, the closing one and the audio one left out
    expect(pace).toMatchObject({ sessions: 1, pages: 60, hours: 1, prior: 29, priorOf: "French print" });
    expect(pace.value).toBeCloseTo(118 / 3, 6);
    expect(pagesPerHour(reading({}), noPriors).value).toBe(30);
  });
});

describe("time left", () => {
  it("is the remaining pages over the pace", () => {
    const t = timeLeft(reading({ totalPages: 400, currentPercent: 50 }), noPriors);
    expect(t).toMatchObject({ kind: "pages", remainingPages: 200 });
    expect(t.kind === "pages" && Math.round(t.minutes)).toBe(400);
    expect(timeLeftText(t)).toBe("About 6 h 40 min left");
  });
  it("is the remaining book minutes at his listening speed: shorter at 1.5×", () => {
    const audio = reading({ format: "audio", unit: "minutes", totalPages: null, totalMinutes: 600, currentMinutes: 300 });
    const at1 = timeLeft(audio, noPriors);
    expect(at1.kind === "audio" && Math.round(at1.minutes)).toBe(300);
    // 600 book minutes listened in 400: 1.5×, blended with an hour at 1×
    const fast = { ...audio, sessions: [session({ format: "audio", durationSeconds: 400 * 60, minutesAdvanced: 600, pages: 0 })] };
    expect(listeningFactor(fast).factor).toBeCloseTo(460 / 660, 6);
    const at15 = timeLeft(fast, noPriors);
    expect(at15.kind === "audio" && at15.minutes).toBeLessThan(300);
    expect(paceExplanation(fast, noPriors, "2026-10-05")).toMatch(/^From 1 session: you listen at about 1\.4×, so 5 h of the book takes about 3 h 29 min\./);
  });
  it("needs a page count or an audio length", () => {
    expect(timeLeft(reading({ totalPages: null }), priors)).toEqual({ kind: "none", text: "Add the page count for an estimate" });
  });
});

describe("the finish date", () => {
  const today = "2026-10-12";
  it("needs three sessions on two days", () => {
    expect(finishEstimate(reading({ sessions: [session({}), session({})] }), today)).toEqual({ kind: "none", text: "Log a few sessions for an estimate" });
    expect(finishEstimate(reading({ sessions: [session({}), session({}), session({})] }), today).kind).toBe("none");
  });
  it("divides what is left by a weighted daily rate, days without reading included", () => {
    // 30 pages on each of the last 12 days
    const daily = Array.from({ length: 12 }, (_, i) => session({ readOn: `2026-10-${String(i + 1).padStart(2, "0")}`, pages: 30 }));
    const e = finishEstimate(reading({ sessions: daily }), today);
    expect(e).toMatchObject({ kind: "date", perDay: 30, days: 12, date: "2026-10-19" });
    expect(finishText(e, today)).toBe("Around 19 Oct");
    // 30 pages every other day: the days between count, so about half the rate and a later date
    const gaps = Array.from({ length: 6 }, (_, i) => session({ readOn: `2026-10-${String(2 * i + 1).padStart(2, "0")}`, pages: 30 }));
    const g = finishEstimate(reading({ sessions: gaps }), today);
    expect(g.kind === "date" && g.date > "2026-10-19").toBe(true);
  });
  it("leaves paused days out", () => {
    const sessions = [session({ readOn: "2026-09-01", pages: 30 }), session({ readOn: "2026-09-02", pages: 30 }), session({ readOn: "2026-10-12", pages: 30 })];
    const paused = finishEstimate(reading({ sessions, pauses: [{ from: "2026-09-03", to: "2026-10-12" }] }), today);
    const open = finishEstimate(reading({ sessions }), today);
    expect(paused.kind === "date" && open.kind === "date" && paused.perDay > open.perDay).toBe(true);
    expect(paused.kind === "date" && paused.days).toBe(3);
  });
  it("gives a range when the rate is unsteady", () => {
    const bursty = [session({ readOn: "2026-10-01", pages: 300 }), session({ readOn: "2026-10-11", pages: 5 }), session({ readOn: "2026-10-12", pages: 5 })];
    const e = finishEstimate(reading({ sessions: bursty, totalPages: 1000, currentPercent: 10 }), today);
    expect(e.kind === "date" && e.earliest < e.latest).toBe(true);
    expect(finishText(e, today)).toMatch(/^Between /);
  });
  it("explains itself", () => {
    const daily = Array.from({ length: 12 }, (_, i) => session({ readOn: `2026-10-${String(i + 1).padStart(2, "0")}`, pages: 30, durationSeconds: 3600 }));
    expect(paceExplanation(reading({ sessions: daily }), priors, today)).toBe(
      "From 12 sessions over 12 days: 30 pages a day, 30 pages an hour. Your usual pace in French print is 29 pages an hour. Pages are counted against each edition's page count.",
    );
  });
});

describe("the estimate line", () => {
  it("joins time left and the finish date, and explains both", () => {
    const sessions = [1, 2, 3].map((d) => session({ readOn: `2026-10-0${d}`, pages: 30, durationSeconds: 3600 }));
    const e = readingEstimate(reading({ totalPages: 300, currentPercent: 30, sessions }), noPriors, "2026-10-03");
    expect(e.text).toBe("About 7 h left · Around 10 Oct");
    expect(e.explanation).toContain("From 3 sessions over 3 days: 30 pages a day, 30 pages an hour.");
    expect(e.needsLength).toBe(false);
  });

  it("asks for the page count when there is nothing to measure", () => {
    expect(readingEstimate(reading({ totalPages: null }), noPriors, "2026-10-03")).toEqual({
      text: "Add the page count for an estimate",
      explanation: null,
      needsLength: true,
    });
  });

  it("says when there are too few sessions for a date", () => {
    expect(readingEstimate(reading({}), noPriors, "2026-10-03").text).toBe("About 6 h 40 min left · Log a few sessions for an estimate");
  });
});
