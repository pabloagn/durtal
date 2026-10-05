import { formatReadingDate } from "./dates";
import type { ReadingFormat } from "./constants";

/*
 * Pace and estimates (SLN-451). Pure: `getPaceContext` gives the inputs in
 * one query per page, counted with `countedPagesSql` and without the running
 * timer. Every estimate says what it is based on, and none scolds: a slow
 * book just gets a later date.
 */

/** Pages an hour when nothing else is known */
export const DEFAULT_PAGES_PER_HOUR = 30;
/** Hours of the prior blended into a reading's own pace */
const PRIOR_HOURS = 2;
/** Minutes of the 1× prior blended into a reading's listening speed */
const LISTEN_PRIOR_MINUTES = 60;
const HALF_LIFE_DAYS = 14;

export interface PaceSession {
  readOn: string;
  durationSeconds: number | null;
  /** countedPagesSql pages of the session */
  pages: number;
  format: ReadingFormat;
  /** Book minutes the session moved (audio), when above 0 */
  minutesAdvanced: number | null;
}

export interface PaceReading {
  readingId: string;
  format: ReadingFormat;
  unit: "pages" | "percent" | "minutes";
  /** The edition's language: the prior's first choice */
  language: string | null;
  totalPages: number | null;
  totalMinutes: number | null;
  currentPercent: number | null;
  currentMinutes: number | null;
  /** Ended sessions only */
  sessions: PaceSession[];
  /** Paused intervals, as reading days: [from, to) with to null while paused */
  pauses: { from: string; to: string | null }[];
}

export interface PacePriors {
  /** Pages an hour over the last two years, by "language|format" */
  byLanguageFormat: Record<string, number>;
  byFormat: Partial<Record<ReadingFormat, number>>;
  overall: number | null;
}

export interface PagesPerHour {
  value: number;
  sessions: number;
  pages: number;
  hours: number;
  prior: number;
  /** "French print", "print", "everything", null for the 30 pages default */
  priorOf: string | null;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  ru: "Russian",
  ja: "Japanese",
  la: "Latin",
};
const FORMAT_WORDS: Record<ReadingFormat, string> = { print: "print", ebook: "e-books", audio: "audio" };

/** His usual pages an hour for this language and format, else the format, else everything, else 30 */
export function priorFor(priors: PacePriors, language: string | null, format: ReadingFormat): { value: number; of: string | null } {
  const lf = language ? priors.byLanguageFormat[`${language}|${format}`] : undefined;
  if (lf) return { value: lf, of: `${LANGUAGE_NAMES[language!] ?? language} ${FORMAT_WORDS[format]}` };
  const f = priors.byFormat[format];
  if (f) return { value: f, of: FORMAT_WORDS[format] };
  if (priors.overall) return { value: priors.overall, of: "everything" };
  return { value: DEFAULT_PAGES_PER_HOUR, of: null };
}

/**
 * Pages an hour: counted pages over hours from the sessions that have a
 * duration, count pages, and are print or e-book, blended with the prior so
 * one short session does not swing it.
 */
export function pagesPerHour(r: PaceReading, priors: PacePriors): PagesPerHour {
  const timed = r.sessions.filter((s) => (s.durationSeconds ?? 0) > 0 && s.pages > 0 && s.format !== "audio");
  const pages = timed.reduce((sum, s) => sum + s.pages, 0);
  const hours = timed.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0) / 3600;
  const prior = priorFor(priors, r.language, r.format === "audio" ? "print" : r.format);
  return { value: (pages + PRIOR_HOURS * prior.value) / (hours + PRIOR_HOURS), sessions: timed.length, pages, hours, prior: prior.value, priorOf: prior.of };
}

/** Session minutes per book minute in this reading's audio sessions, blended with 1×; below 1 is faster */
export function listeningFactor(r: PaceReading): { factor: number; sessions: number } {
  const audio = r.sessions.filter((s) => s.format === "audio" && (s.durationSeconds ?? 0) > 0 && (s.minutesAdvanced ?? 0) > 0);
  const listened = audio.reduce((sum, s) => sum + (s.durationSeconds ?? 0) / 60, 0);
  const advanced = audio.reduce((sum, s) => sum + (s.minutesAdvanced ?? 0), 0);
  return { factor: (listened + LISTEN_PRIOR_MINUTES) / (advanced + LISTEN_PRIOR_MINUTES), sessions: audio.length };
}

/** "6 h 40 min", "45 min" */
export function hoursWords(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`;
}

const isAudio = (r: PaceReading) => (r.unit === "minutes" || r.format === "audio") && (r.totalMinutes ?? 0) > 0;

export type TimeLeft =
  | { kind: "pages"; minutes: number; remainingPages: number; pace: PagesPerHour }
  | { kind: "audio"; minutes: number; remainingBookMinutes: number; factor: number; sessions: number }
  | { kind: "none"; text: string };

/** Reading time left: remaining pages over the pace, or remaining book minutes at his listening speed */
export function timeLeft(r: PaceReading, priors: PacePriors): TimeLeft {
  if (isAudio(r)) {
    const remainingBookMinutes = Math.max(0, (r.totalMinutes ?? 0) - (r.currentMinutes ?? 0));
    const { factor, sessions } = listeningFactor(r);
    return { kind: "audio", minutes: remainingBookMinutes * factor, remainingBookMinutes, factor, sessions };
  }
  if (r.totalPages) {
    const remainingPages = (r.totalPages * (100 - (r.currentPercent ?? 0))) / 100;
    const pace = pagesPerHour(r, priors);
    return { kind: "pages", minutes: (remainingPages / pace.value) * 60, remainingPages, pace };
  }
  return { kind: "none", text: "Add the page count for an estimate" };
}

/** "About 6 h 40 min left" */
export function timeLeftText(t: TimeLeft): string {
  return t.kind === "none" ? t.text : `About ${hoursWords(t.minutes)} left`;
}

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS;
const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export type FinishEstimate =
  | { kind: "date"; date: string; earliest: string; latest: string; perDay: number; days: number; sessions: number; unit: "pages" | "minutes" }
  | { kind: "none"; text: string };

/**
 * The finish date: today plus what is left over the daily rate, an
 * exponentially weighted average (14-day half-life) from the first session's
 * day to today, days without reading included and paused days left out.
 * Shown after three ended sessions on two days; a range when the rate is
 * unsteady.
 */
export function finishEstimate(r: PaceReading, today: string): FinishEstimate {
  const audio = isAudio(r);
  const ended = r.sessions;
  if (ended.length < 3 || new Set(ended.map((s) => s.readOn)).size < 2) return { kind: "none", text: "Log a few sessions for an estimate" };
  const left = audio ? Math.max(0, (r.totalMinutes ?? 0) - (r.currentMinutes ?? 0)) : r.totalPages ? (r.totalPages * (100 - (r.currentPercent ?? 0))) / 100 : null;
  if (left === null) return { kind: "none", text: "Add the page count for an estimate" };
  const perDayAmount = new Map<number, number>();
  for (const s of ended) {
    const amount = audio ? (s.minutesAdvanced ?? 0) : s.pages;
    perDayAmount.set(dayNumber(s.readOn), (perDayAmount.get(dayNumber(s.readOn)) ?? 0) + amount);
  }
  const first = Math.min(...perDayAmount.keys());
  const last = dayNumber(today);
  const paused = (n: number) => r.pauses.some((p) => n >= dayNumber(p.from) && (p.to === null || n < dayNumber(p.to)));
  let weights = 0;
  let sum = 0;
  let squares = 0;
  let days = 0;
  for (let n = first; n <= last; n++) {
    if (paused(n) && !perDayAmount.has(n)) continue;
    const w = 0.5 ** ((last - n) / HALF_LIFE_DAYS);
    const v = perDayAmount.get(n) ?? 0;
    weights += w;
    sum += w * v;
    squares += w * v * v;
    days++;
  }
  // Rounded, so a steady 30 pages a day is 30, not 30.000000000000004
  const rate = weights ? Math.round((sum / weights) * 1e6) / 1e6 : 0;
  if (rate <= 0) return { kind: "none", text: "Log a few sessions for an estimate" };
  const spread = Math.sqrt(Math.max(0, squares / weights - rate * rate)) / rate;
  const daysLeft = Math.ceil(left / rate);
  const unsteady = spread > 1.2;
  const earliest = unsteady ? Math.ceil(left / (rate * 1.3)) : daysLeft;
  const latest = unsteady ? Math.ceil(left / (rate * 0.7)) : daysLeft;
  return {
    kind: "date",
    date: dayString(last + daysLeft),
    earliest: dayString(last + earliest),
    latest: dayString(last + latest),
    perDay: rate,
    days,
    sessions: ended.length,
    unit: audio ? "minutes" : "pages",
  };
}

/** "Around 18 Oct", "between 14 and 25 Oct", "between 28 Oct and 3 Nov" */
export function finishText(e: FinishEstimate, today: string): string {
  if (e.kind === "none") return e.text;
  const omitYear = (d: string) => d.slice(0, 4) === today.slice(0, 4);
  const fmt = (d: string) => formatReadingDate(d, "day", { omitYear: omitYear(d) });
  if (e.earliest === e.latest) return `Around ${fmt(e.date)}`;
  const sameMonth = e.earliest.slice(0, 7) === e.latest.slice(0, 7);
  return sameMonth ? `Between ${Number(e.earliest.slice(8))} and ${fmt(e.latest)}` : `Between ${fmt(e.earliest)} and ${fmt(e.latest)}`;
}

const round = (n: number) => Math.round(n);

/** What an estimate is based on, for its info popover */
export function paceExplanation(r: PaceReading, priors: PacePriors, today: string): string {
  const left = timeLeft(r, priors);
  const finish = finishEstimate(r, today);
  if (left.kind === "audio") {
    const speed = 1 / left.factor;
    const from = left.sessions ? `From ${left.sessions} ${left.sessions === 1 ? "session" : "sessions"}: you` : "You";
    return `${from} listen at about ${speed.toFixed(1)}×, so ${hoursWords(left.remainingBookMinutes)} of the book takes about ${hoursWords(left.minutes)}.${
      finish.kind === "date" ? ` ${round(finish.perDay)} minutes of the book a day over ${finish.days} days.` : ""
    }`;
  }
  if (left.kind === "none") return left.text;
  const p = left.pace;
  const parts: string[] = [];
  if (finish.kind === "date")
    parts.push(`From ${finish.sessions} sessions over ${finish.days} days: ${round(finish.perDay)} pages a day, ${round(p.value)} pages an hour.`);
  else if (p.sessions) parts.push(`From ${p.sessions} timed ${p.sessions === 1 ? "session" : "sessions"}: ${round(p.value)} pages an hour.`);
  else parts.push(`No timed sessions yet: ${round(p.value)} pages an hour.`);
  parts.push(p.priorOf ? `Your usual pace in ${p.priorOf} is ${round(p.prior)} pages an hour.` : `With no pace of yours yet, 30 pages an hour is assumed.`);
  parts.push("Pages are counted against each edition's page count.");
  return parts.join(" ");
}

export interface ReadingEstimate {
  /** "About 6 h 40 min left · Around 18 Oct", or what to add for one */
  text: string;
  /** What it is based on, for the info popover; null when there is no estimate */
  explanation: string | null;
  /** No page count and no audio length: on the book page the line opens Edit reading */
  needsLength: boolean;
}

/** Time left and the finish date as one line, with its explanation */
export function readingEstimate(r: PaceReading, priors: PacePriors, today: string): ReadingEstimate {
  const left = timeLeft(r, priors);
  if (left.kind === "none") return { text: left.text, explanation: null, needsLength: true };
  return { text: `${timeLeftText(left)} · ${finishText(finishEstimate(r, today), today)}`, explanation: paceExplanation(r, priors, today), needsLength: false };
}
