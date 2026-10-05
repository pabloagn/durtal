import type { GoalMetric, ReadingDatePrecision } from "./constants";

/*
 * Reading goals and the weekly rhythm (SLN-455). Pure: the server renders
 * with its reading day, the browser recomputes with its own. Goals never nag:
 * no word here says a goal is behind, lost or failed, and the rhythm keeps
 * no streak.
 */

/** Words the goals and the rhythm never use */
export const NEVER_SAID = ["behind", "streak", "lost", "fail"] as const;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const UNITS: Record<GoalMetric, [string, string]> = { books: ["book", "books"], pages: ["page", "pages"], hours: ["hour", "hours"] };

const n = (value: number) => value.toLocaleString("en-US");

/** "1 book", "30 books", "1,200 pages", "2.5 hours" */
export function amountText(metric: GoalMetric, value: number): string {
  const shown = metric === "hours" && value < 10 && value % 1 !== 0 ? Math.round(value * 10) / 10 : Math.floor(value);
  const [one, many] = UNITS[metric];
  return `${n(shown)} ${shown === 1 ? one : many}`;
}

/** "12 of 30 books" */
export function goalTitle(metric: GoalMetric, count: number, target: number): string {
  const shown = metric === "hours" && count < 10 && count % 1 !== 0 ? Math.round(count * 10) / 10 : Math.floor(count);
  return `${n(shown)} of ${amountText(metric, target)}`;
}

/** Whole days from 1970-01-01 to a "YYYY-MM-DD" day */
function epochDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** The day `count` days after `day` */
export function addDays(day: string, count: number): string {
  return new Date((epochDay(day) + count) * 86_400_000).toISOString().slice(0, 10);
}

export function daysInYear(year: number): number {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
}

/** 1 for 1 January */
export function dayOfYear(day: string): number {
  return epochDay(day) - epochDay(`${day.slice(0, 4)}-01-01`) + 1;
}

/** The share of `year` gone by the end of `today`: 0 before it starts, 1 after it ends */
export function expectedShare(year: number, today: string): number {
  const current = Number(today.slice(0, 4));
  if (current < year) return 0;
  if (current > year) return 1;
  return dayOfYear(today) / daysInYear(year);
}

/** "Goal reached on 14 Oct", "in October", "in 2026" */
export function reachedText(on: string, precision: ReadingDatePrecision): string {
  const [y, m, d] = on.split("-").map(Number);
  if (precision === "year") return `Goal reached in ${y}`;
  if (precision === "month") return `Goal reached in ${MONTHS[m - 1]}`;
  return `Goal reached on ${d} ${SHORT[m - 1]}`;
}

/** "about one every 2 weeks", "about 40 pages a day", "about 20 minutes a day" */
function paceText(metric: GoalMetric, remaining: number, daysLeft: number): string {
  if (metric === "books") {
    const every = daysLeft / remaining;
    if (every >= 13.5) return `about one every ${Math.round(every / 7)} weeks`;
    if (every >= 1.5) return Math.round(every) === 7 ? "about one a week" : `about one every ${Math.round(every)} days`;
    if (every >= 0.75) return "about one a day";
    return `about ${Math.round(1 / every)} a day`;
  }
  if (metric === "pages") return `about ${n(Math.max(1, Math.round(remaining / daysLeft)))} pages a day`;
  const minutes = (remaining * 60) / daysLeft;
  if (minutes >= 90) return `about ${Math.round(minutes / 6) / 10} hours a day`;
  if (minutes >= 10) return `about ${Math.round(minutes)} minutes a day`;
  return `about ${Math.max(1, Math.round(minutes * 7))} minutes a week`;
}

export interface GoalState {
  metric: GoalMetric;
  year: number;
  target: number;
  count: number;
  reachedOn: string | null;
  reachedPrecision: ReadingDatePrecision | null;
}

/**
 * The goal's one neutral line for `today` (a reading day): "On pace", "2
 * books ahead", "18 to go: about one every 2 weeks from now", or "Goal
 * reached on 14 Oct". Never a word of NEVER_SAID.
 */
/**
 * Where the count stands against the share of the year gone: ahead by whole
 * units, on pace (within one book, or 1% of a pages or hours goal), or with
 * some to go
 */
function standing(goal: GoalState, today: string): { ahead: number } | { onPace: true } | { remaining: number } {
  const expected = goal.target * expectedShare(goal.year, today);
  const diff = goal.count - expected;
  if (diff >= 1) return { ahead: Math.floor(diff) };
  const tolerance = goal.metric === "books" ? 1 : Math.max(1, goal.target / 100);
  if (diff > -tolerance) return { onPace: true };
  return { remaining: goal.target - goal.count };
}

/**
 * The goal's one neutral line for `today` (a reading day): "On pace", "2
 * books ahead", "18 to go: about one every 2 weeks from now", or "Goal
 * reached on 14 Oct". Never a word of NEVER_SAID.
 */
export function goalLine(goal: GoalState, today: string): string {
  if (goal.count >= goal.target && goal.reachedOn) return reachedText(goal.reachedOn, goal.reachedPrecision ?? "day");
  if (goal.count >= goal.target) return "Goal reached";
  const where = standing(goal, today);
  if ("ahead" in where) return `${amountText(goal.metric, where.ahead)} ahead`;
  if ("onPace" in where) return "On pace";
  const current = Number(today.slice(0, 4));
  const daysLeft = current < goal.year ? daysInYear(goal.year) : daysInYear(goal.year) - dayOfYear(today) + 1;
  return `${n(Math.ceil(where.remaining))} to go: ${paceText(goal.metric, where.remaining, Math.max(1, daysLeft))} from now`;
}

/** The dashboard's short words: "on pace", "2 books ahead", "18 to go", "goal reached" */
export function goalShortLine(goal: GoalState, today: string): string {
  if (goal.count >= goal.target) return "goal reached";
  const where = standing(goal, today);
  if ("ahead" in where) return `${amountText(goal.metric, where.ahead)} ahead`;
  if ("onPace" in where) return "on pace";
  return `${n(Math.ceil(where.remaining))} to go`;
}

/** A past year's result, plainly: "28 of 30 books in 2025" */
export function pastGoalText(goal: Pick<GoalState, "metric" | "year" | "target" | "count">): string {
  return `${goalTitle(goal.metric, goal.count, goal.target)} in ${goal.year}`;
}

/** Where the year would end at the pace of the last 90 days */
export function projection(goal: Pick<GoalState, "year" | "count">, last90: number, today: string): number {
  const current = Number(today.slice(0, 4));
  if (current !== goal.year) return goal.count;
  const daysLeft = daysInYear(goal.year) - dayOfYear(today);
  return goal.count + (last90 / 90) * daysLeft;
}

/* ── The weekly rhythm ─────────────────────────────────────────────────── */

/** 1 Monday ... 7 Sunday, like ISO */
function isoWeekday(day: string): number {
  return ((((epochDay(day) + 3) % 7) + 7) % 7) + 1;
}

/** The first day of the week holding `day`, for weeks starting on Monday (1) or Sunday (7) */
export function weekStartOf(day: string, weekStart: 1 | 7): string {
  const offset = weekStart === 1 ? isoWeekday(day) - 1 : isoWeekday(day) % 7;
  return addDays(day, -offset);
}

/** The seven days of the week holding `today`, in order */
export function weekDays(today: string, weekStart: 1 | 7): string[] {
  const first = weekStartOf(today, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

export interface RhythmView {
  /** This week, in order: each day, whether he read, whether it is today */
  week: { day: string; read: boolean; today: boolean; label: string }[];
  /** Reading days this week so far */
  thisWeek: number;
  /** The 12 weeks before this one, oldest first: their reading days and whether they reached the target */
  weeks: { start: string; days: number; kept: boolean }[];
  kept: number;
}

const DAY_LETTERS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** This week and the 12 before it, from the reading days he read */
export function rhythmView(readDays: Iterable<string>, today: string, weekStart: 1 | 7, target: number): RhythmView {
  const read = new Set(readDays);
  const week = weekDays(today, weekStart).map((day) => ({ day, read: read.has(day), today: day === today, label: DAY_LETTERS[isoWeekday(day) - 1] }));
  const first = week[0].day;
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = addDays(first, -7 * (12 - i));
    const days = Array.from({ length: 7 }, (_, k) => addDays(start, k)).filter((d) => read.has(d)).length;
    return { start, days, kept: days >= target };
  });
  return { week, thisWeek: week.filter((d) => d.read && d.day <= today).length, weeks, kept: weeks.filter((w) => w.kept).length };
}

/**
 * The first and last day the rhythm needs, on the server's day: the 12 weeks
 * before yesterday's week, and tomorrow, each with a day to spare. A browser
 * a day behind (21:30 on Sunday in Mexico City is Monday in Amsterdam) draws
 * the week before the server's, so the range starts from yesterday's week.
 */
export function rhythmRange(today: string, weekStart: 1 | 7): { from: string; to: string } {
  return { from: addDays(weekStartOf(addDays(today, -1), weekStart), -7 * 12 - 1), to: addDays(today, 2) };
}
