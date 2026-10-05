import { addDays, weekStartOf } from "./goals";

/*
 * The reading charts' pure parts (SLN-456): scales and ticks, the calendar's
 * layout, the keyboard model, and fixed English labels (no Intl, so the
 * server and the browser write the same text).
 */

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The top of a scale: max rounded up to 1, 2, 2.5 (from 25) or 5 times a power of ten; 1 for nothing or less */
export function niceMax(max: number): number {
  if (!(max > 1)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => Number.isInteger(s * power) && s * power >= max)!;
  return step * power;
}

/** Ticks from 0 to niceMax(max): whole steps of 1, 2, 2.5 or 5 times a power of ten that end on the top, `count` steps at most */
export function ticks(max: number, count = 5): number[] {
  const top = niceMax(max);
  let step = top;
  for (let power = 1; power <= top; power *= 10)
    for (const m of [1, 2, 2.5, 5]) {
      const s = m * power;
      if (Number.isInteger(s) && s >= top / count && top % s === 0 && s < step) step = s;
    }
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

/* ── The calendar ──────────────────────────────────────────────────────── */

export interface CalendarCell {
  day: string;
  /** Its place in the year's days, 0 for 1 January */
  index: number;
  /** 0 to 6 in the week's order */
  column: number;
  /** The week row, 0 for the week holding 1 January */
  row: number;
}

/**
 * A year's days in week rows, each row starting on the reading week's first
 * day (1 Monday, 7 Sunday). Days of the next or last year are left out.
 */
export function calendarCells(year: number, weekStart: 1 | 7): CalendarCell[] {
  const first = `${year}-01-01`;
  const start = weekStartOf(first, weekStart);
  const cells: CalendarCell[] = [];
  for (let index = 0; ; index++) {
    const day = addDays(first, index);
    if (day.slice(0, 4) !== String(year)) break;
    const offset = Math.round((Date.parse(day) - Date.parse(start)) / 86_400_000);
    cells.push({ day, index, column: offset % 7, row: Math.floor(offset / 7) });
  }
  return cells;
}

/** The calendar's weeks split into blocks side by side: 4 blocks of up to 14 week rows */
export function calendarBlocks(rows: number, blocks = 4): { from: number; to: number }[] {
  const size = Math.ceil(rows / blocks);
  return Array.from({ length: blocks }, (_, i) => ({ from: i * size, to: Math.min(rows, (i + 1) * size) - 1 })).filter((b) => b.from <= b.to);
}

/** The shade of a day, 0 (nothing) to 4, against the year's busiest day */
export function shade(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

/* ── The keyboard ──────────────────────────────────────────────────────── */

/**
 * The focus point after a key: Left and Right by one, Up and Down by `step`
 * (a week in the calendar, one in a bar chart), Home and End to the first and
 * last. Null when the key does not move it. It never leaves the chart.
 */
export function moveFocus(index: number | null, key: string, count: number, step = 1): number | null {
  if (count <= 0) return null;
  const at = index ?? 0;
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  switch (key) {
    case "ArrowRight":
      return index === null ? 0 : clamp(at + 1);
    case "ArrowLeft":
      return index === null ? 0 : clamp(at - 1);
    case "ArrowDown":
      return index === null ? 0 : clamp(at + step);
    case "ArrowUp":
      return index === null ? 0 : clamp(at - step);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** "1,210" */
export const n = (value: number) => Math.round(value).toLocaleString("en-US");

/** "3 Feb 2026" from a YYYY-MM-DD day */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "1 h 20 min", "45 min" */
export function minutesLabel(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/** The stats page's year from `?year=`: a year with readings, "all" for all time (null), else the default */
export function parseStatsYear(param: string | string[] | undefined, years: number[], fallback: number): number | null {
  const value = Array.isArray(param) ? param[0] : param;
  if (value === "all") return null;
  const year = Number(value);
  return /^\d{4}$/.test(value ?? "") && years.includes(year) ? year : fallback;
}

/** "Sunday evenings", from the peak weekday (1 Monday) and part of day */
export function peakWords(peak: { weekday: number; part: string } | null): string | null {
  if (!peak) return null;
  const parts: Record<string, string> = { night: "nights", morning: "mornings", afternoon: "afternoons", evening: "evenings" };
  return `${WEEKDAYS[peak.weekday - 1]} ${parts[peak.part] ?? ""}`.trim();
}

/** "3.2 years", "1 year", "8 months", "12 days" */
export function durationWords(days: number): string {
  if (days >= 365) {
    const years = Math.round((days / 365.25) * 10) / 10;
    return `${years.toLocaleString("en-US")} ${years === 1 ? "year" : "years"}`;
  }
  if (days >= 60) return `${Math.round(days / 30.44)} months`;
  return `${Math.round(days)} ${Math.round(days) === 1 ? "day" : "days"}`;
}

/** A year's reading days by week: the weeks of the year (calendar rows), the weeks with a reading day, and those with `target` days or more */
export function yearRhythm(days: Iterable<string>, year: number, weekStart: 1 | 7, target: number | null): { weeks: number; weeksRead: number; kept: number | null } {
  const cells = calendarCells(year, weekStart);
  const rowOf = new Map(cells.map((c) => [c.day, c.row]));
  const perWeek = new Map<number, number>();
  for (const day of new Set(days)) {
    const row = rowOf.get(day);
    if (row !== undefined) perWeek.set(row, (perWeek.get(row) ?? 0) + 1);
  }
  return {
    weeks: cells.at(-1)!.row + 1,
    weeksRead: perWeek.size,
    kept: target === null ? null : [...perWeek.values()].filter((d) => d >= target).length,
  };
}

/** When a book was finished, at its precision: "3 Jan", "January", "2026" */
export function finishText(day: string, precision: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (precision === "year") return String(y);
  if (precision === "month") return MONTHS[m - 1];
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/**
 * Whether bars can stand side by side: each band holds its label (12px text,
 * about 7px a character, 8px apart). Past that they lie down, one per row.
 */
export function barsFit(width: number, labels: string[], axis = 36): boolean {
  if (!labels.length) return true;
  const widest = Math.max(...labels.map((l) => l.length)) * 7 + 8;
  return (width - axis) / labels.length >= widest;
}
