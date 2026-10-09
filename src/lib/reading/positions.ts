import type { ReadingUnit } from "./constants";

/*
 * Where a reader is in a book (SLN-444). Pure and unit tested. A position is
 * a page of an edition, minutes of an audiobook, or a share of the work; the
 * share is always kept, so a place survives a change of edition or format.
 */

export interface Position {
  page?: number | null;
  minutes?: number | null;
  percent?: number | null;
}
export interface Totals {
  totalPages?: number | null;
  totalMinutes?: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The share of the work a position stands for, rounded to 2 decimals; null when it cannot be known */
export function percentOf(position: Position, totals: Totals): number | null {
  if (position.page != null && totals.totalPages) return round2(Math.min(100, (position.page / totals.totalPages) * 100));
  if (position.minutes != null && totals.totalMinutes)
    return round2(Math.min(100, (position.minutes / totals.totalMinutes) * 100));
  if (position.percent != null) return round2(position.percent);
  return null;
}

/**
 * A share of the work as a place in another edition or format: the page
 * (null without a page count), the minutes (null without a length), and the
 * share itself.
 */
export function remapPosition(percent: number | null, totals: Totals) {
  if (percent == null) return { page: null, minutes: null, percent: null };
  return {
    page: totals.totalPages ? Math.round((percent / 100) * totals.totalPages) : null,
    minutes: totals.totalMinutes ? Math.round((percent / 100) * totals.totalMinutes) : null,
    percent: round2(percent),
  };
}

/** Normalize a reading's primary unit; the other counters are derived caches. */
export function positionInUnit(position: Position, unit: ReadingUnit, totals: Totals) {
  const given = unit === "percent" && position.percent != null ? { percent: position.percent }
    : unit === "minutes" && position.minutes != null ? { minutes: position.minutes, percent: position.percent }
    : unit === "pages" && position.page != null ? { page: position.page, percent: position.percent }
    : position;
  const percent = percentOf(given, totals);
  return { ...remapPosition(percent, totals),
    ...(given.page != null ? { page: given.page } : {}),
    ...(given.minutes != null ? { minutes: given.minutes } : {}) };
}

/** Whether an absolute, single-unit edit differs from the reading's effective place. */
export function positionChanges(given: Position | undefined, current: Position) {
  if (given?.page != null) return given.page !== current.page;
  if (given?.minutes != null) return given.minutes !== current.minutes;
  if (given?.percent != null) return current.percent == null || round2(given.percent) !== round2(current.percent);
  return false;
}

/** "3:12" for 192 minutes */
export function formatMinutes(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

export interface ProgressContext extends Totals {
  unit: ReadingUnit;
}

export type ProgressInput =
  | { kind: "page"; page: number; totalPages?: number }
  | { kind: "percent"; percent: number }
  | { kind: "minutes"; minutes: number }
  | { kind: "addPages"; pages: number }
  | { kind: "addMinutes"; minutes: number }
  | { kind: "chapter"; chapter: string };

export type ParsedProgress = { ok: true; value: ProgressInput } | { ok: false; error: string };

const HINT = "Enter a page (212), a percent (44%), a time (3:12) or a chapter (ch 7)";

function page(value: number, totals: Totals, totalPages?: number): ParsedProgress {
  const total = totalPages ?? totals.totalPages ?? null;
  if (!Number.isInteger(value) || value < 0) return { ok: false, error: "Enter a whole page number" };
  if (totalPages !== undefined && (!Number.isInteger(totalPages) || totalPages <= 0))
    return { ok: false, error: "Enter the number of pages above 0" };
  if (total && value > total) return { ok: false, error: `Page ${value} is past the last page, ${total}` };
  return { ok: true, value: totalPages !== undefined ? { kind: "page", page: value, totalPages } : { kind: "page", page: value } };
}

function percent(value: number): ParsedProgress {
  if (!Number.isFinite(value) || value < 0 || value > 100) return { ok: false, error: "Enter 0 to 100%" };
  return { ok: true, value: { kind: "percent", percent: round2(value) } };
}

function minutes(value: number, totals: Totals): ParsedProgress {
  if (!Number.isInteger(value) || value < 0) return { ok: false, error: "Enter a time such as 3:12" };
  if (totals.totalMinutes && value > totals.totalMinutes)
    return { ok: false, error: `${formatMinutes(value)} is past the end, ${formatMinutes(totals.totalMinutes)}` };
  return { ok: true, value: { kind: "minutes", minutes: value } };
}

/**
 * One input for progress: "212", "p 212", "p. 212", "page 212", "212/480"
 * (also the page count), "44%", "+20" (that many pages, or minutes for an
 * audiobook, on), "3:12" or "3h12" (audio), "ch 7" or "chapter 7". A bare
 * number is in the reading's unit.
 */
export function parseProgressInput(text: string, context: ProgressContext): ParsedProgress {
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return { ok: false, error: HINT };
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(?:chapter|ch\.?) ?(.+)$/))) {
    const chapter = text.trim().replace(/^(?:chapter|ch\.?)\s*/i, "").trim();
    if (!chapter || chapter.length > 300) return { ok: false, error: "Enter a chapter of up to 300 characters" };
    return { ok: true, value: { kind: "chapter", chapter } };
  }
  if ((m = s.match(/^\+ ?(\d+)$/))) {
    const n = Number(m[1]);
    if (n <= 0) return { ok: false, error: "Enter how far you read, above 0" };
    return { ok: true, value: context.unit === "minutes" ? { kind: "addMinutes", minutes: n } : { kind: "addPages", pages: n } };
  }
  if ((m = s.match(/^(\d+(?:[.,]\d+)?) ?%$/))) return percent(Number(m[1].replace(",", ".")));
  if ((m = s.match(/^(?:p|p\.|page|pg) ?(\d+)$/))) return page(Number(m[1]), context);
  if ((m = s.match(/^(\d+) ?\/ ?(\d+)$/))) return page(Number(m[1]), context, Number(m[2]));
  if ((m = s.match(/^(\d+):([0-5]\d)$/))) return minutes(Number(m[1]) * 60 + Number(m[2]), context);
  if ((m = s.match(/^(\d+) ?h ?(?:([0-5]?\d) ?(?:m|min)?)?$/))) return minutes(Number(m[1]) * 60 + Number(m[2] ?? 0), context);
  if ((m = s.match(/^(\d+) ?(?:m|min|mins|minutes)$/))) return minutes(Number(m[1]), context);
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)$/))) {
    const n = Number(m[1].replace(",", "."));
    if (context.unit === "percent") return percent(n);
    if (context.unit === "minutes") return minutes(n, context);
    return page(n, context);
  }
  return { ok: false, error: HINT };
}
