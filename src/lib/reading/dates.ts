import { z } from "zod/v4";
import { appTimeZone } from "@/lib/utils/date";
import type { ReadingDatePrecision, ReadingStatus } from "./constants";

/*
 * Reading days and imprecise dates (SLN-444). Pure: browser code uses it too.
 * A stored date is the first day of its period: "2009" is 2009-01-01 with
 * precision year, "Apr 2019" is 2019-04-01 with precision month.
 */

/** True when the value is an IANA time zone the runtime knows */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().refine(isTimeZone, "Unknown time zone");

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-04" from its parts */
function isoDay(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The day before a YYYY-MM-DD day */
function dayBefore(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return isoDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * The reading day of an instant in a time zone: the calendar day there,
 * except that the hours before `dayStartHour` count for the evening before.
 * The hour is the `reading_day_start_hour` setting (SLN-451): every caller
 * passes it. Uses the local clock, so daylight-saving changes move the
 * boundary with it.
 */
export function readingDay(at: Date, timeZone: string, dayStartHour: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const day = isoDay(part("year"), part("month"), part("day"));
  return part("hour") < dayStartHour ? dayBefore(day) : day;
}

/** The last day of the period a date stands for: the date itself, its month's end, its year's end */
export function readingPeriodEnd(date: string, precision: ReadingDatePrecision): string {
  const [y, m] = date.split("-").map(Number);
  if (precision === "year") return isoDay(y, 12, 31);
  if (precision === "month") {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return isoDay(y, m, last);
  }
  return date;
}

/** The first day of the period: what is stored for "Apr 2019" or "2019" */
export function readingPeriodStart(date: string, precision: ReadingDatePrecision): string {
  const [y, m] = date.split("-").map(Number);
  if (precision === "year") return isoDay(y, 1, 1);
  if (precision === "month") return isoDay(y, m, 1);
  return date;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Apr 2019", "Apr 2019", "2019", "Date unknown" */
export function formatReadingDate(
  date: string | null,
  precision: ReadingDatePrecision,
  { omitYear = false }: { omitYear?: boolean } = {},
): string {
  if (!date || precision === "unknown") return "Date unknown";
  const [y, m, d] = date.split("-").map(Number);
  if (precision === "year") return String(y);
  if (precision === "month") return omitYear ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
  return omitYear ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`;
}

export interface ReadingSpanInput {
  status: ReadingStatus;
  startedOn: string | null;
  startedPrecision: ReadingDatePrecision;
  finishedOn: string | null;
  finishedPrecision: ReadingDatePrecision;
}

/**
 * A read-through's dates in words: "3 to 14 Apr 2019", "Mar 2019 to 14 Apr
 * 2019", "Finished 2009", "Started 2 Oct" (the year left out when it is this
 * year), "Dates unknown".
 */
export function formatReadingSpan(r: ReadingSpanInput, today: string): string {
  const thisYear = today.slice(0, 4);
  const started = r.startedOn && r.startedPrecision !== "unknown";
  const finished = r.finishedOn && r.finishedPrecision !== "unknown";
  if (started && finished) {
    const [sy, sm] = r.startedOn!.split("-");
    const [fy, fm] = r.finishedOn!.split("-");
    const bothDays = r.startedPrecision === "day" && r.finishedPrecision === "day";
    if (bothDays && sy === fy && sm === fm)
      return `${Number(r.startedOn!.slice(8))} to ${formatReadingDate(r.finishedOn, "day")}`;
    if (bothDays && sy === fy)
      return `${formatReadingDate(r.startedOn, "day", { omitYear: true })} to ${formatReadingDate(r.finishedOn, "day")}`;
    return `${formatReadingDate(r.startedOn, r.startedPrecision)} to ${formatReadingDate(r.finishedOn, r.finishedPrecision)}`;
  }
  if (finished)
    return `${r.status === "abandoned" ? "Stopped" : "Finished"} ${formatReadingDate(r.finishedOn, r.finishedPrecision)}`;
  if (started)
    return `Started ${formatReadingDate(r.startedOn, r.startedPrecision, {
      omitYear: r.startedPrecision !== "year" && r.startedOn!.startsWith(thisYear),
    })}`;
  return "Dates unknown";
}

/** Whole days from start to finish, counting both; only for two day-precision dates */
export function daysToFinish(r: Pick<ReadingSpanInput, "startedOn" | "startedPrecision" | "finishedOn" | "finishedPrecision">) {
  if (r.startedPrecision !== "day" || r.finishedPrecision !== "day" || !r.startedOn || !r.finishedOn) return null;
  const ms = Date.parse(`${r.finishedOn}T00:00:00Z`) - Date.parse(`${r.startedOn}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** The precisions a reading date takes in `CatalogueDateField` */
export const READING_DATE_KINDS = ["unknown", "year", "month", "day"] as const;

/**
 * A partial date from `CatalogueDateField` as a reading stores it: the first
 * day of its period and its precision ("2019" is 2019-01-01, year).
 */
export function readingDateOf(value: {
  precision: string;
  start?: { year: number; month?: number | null; day?: number | null } | null;
} | null): { date: string | null; precision: ReadingDatePrecision } {
  const start = value?.start;
  if (!value || !start || !["year", "month", "day"].includes(value.precision)) return { date: null, precision: "unknown" };
  const pad = (n: number) => String(n).padStart(2, "0");
  const precision = value.precision as "year" | "month" | "day";
  const month = precision === "year" ? 1 : (start.month ?? 1);
  const day = precision === "day" ? (start.day ?? 1) : 1;
  return { date: `${String(start.year).padStart(4, "0")}-${pad(month)}-${pad(day)}`, precision };
}

/** The `CatalogueDateField` value of a reading date */
export function catalogueDateOf(date: string | null, precision: ReadingDatePrecision) {
  if (!date || precision === "unknown") return { precision: "unknown" as const };
  const [year, month, day] = date.split("-").map(Number);
  return {
    precision,
    start: { year, month: precision === "year" ? null : month, day: precision === "day" ? day : null },
  };
}
