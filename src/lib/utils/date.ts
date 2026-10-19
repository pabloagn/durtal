/**
 * Calendar-date helpers. A calendar date is a "YYYY-MM-DD" string.
 *
 * `new Date().toISOString()` gives the UTC date, which is yesterday just
 * after local midnight. These helpers give the local date instead.
 */

const DEFAULT_APP_TIMEZONE = "Europe/Amsterdam";

/** The time zone the server uses for calendar dates (`APP_TIMEZONE`). */
export function appTimeZone(): string {
  return process.env.APP_TIMEZONE || DEFAULT_APP_TIMEZONE;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The numeric parts of a moment in a time zone; the month name is ours, so
 * the server and every browser write the same text (SLN-1109) */
function partsIn(at: Date | string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(typeof at === "string" ? new Date(at) : at);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return { day: `${Number(part("day"))} ${MONTHS[Number(part("month")) - 1]} ${part("year")}`, time: `${part("hour")}:${part("minute")}` };
}
/** "18 Oct 2026": the day of a moment in `timeZone` */
export function formatDay(at: Date | string, timeZone: string): string {
  return partsIn(at, timeZone).day;
}
/** "18 Oct 2026, 21:14": a moment in `timeZone` */
export function formatDateTime(at: Date | string, timeZone: string): string {
  const { day, time } = partsIn(at, timeZone);
  return `${day}, ${time}`;
}

/**
 * The calendar date of `now` in `timeZone`. Without a time zone, the
 * runtime's own zone is used.
 */
export function calendarDate(now: Date, timeZone?: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Today's calendar date. In the browser this is the user's local date; on
 * the server it is the date in `APP_TIMEZONE`.
 */
export function todayLocal(now: Date = new Date()): string {
  const timeZone = typeof window === "undefined" ? appTimeZone() : undefined;
  return calendarDate(now, timeZone);
}

/** Adds `days` to a "YYYY-MM-DD" calendar date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
