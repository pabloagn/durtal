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
