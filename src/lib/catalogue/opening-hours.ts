/**
 * A venue's opening hours as the venue page shows them (SLN-292): one row per
 * day, Monday first. `venues.opening_hours` holds what Google Places gives
 * (`regularOpeningHours`, or the object itself): its day lines
 * (`weekdayDescriptions`) when present, else its periods. Anything else is not
 * shown: never raw JSON.
 */

export interface OpeningDay {
  /** "Monday" */
  day: string;
  /** "9:00–17:30", "9:00–13:00, 14:00–18:00", "Closed", "Open 24 hours" */
  hours: string;
}

// Google numbers days from Sunday (0)
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

interface Point {
  day?: number;
  hour?: number;
  minute?: number;
}
interface Period {
  open?: Point;
  close?: Point;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const time = (p: Point) => `${p.hour ?? 0}:${String(p.minute ?? 0).padStart(2, "0")}`;

function fromDescriptions(lines: unknown[]): OpeningDay[] | null {
  const rows = lines.map((line) => {
    if (typeof line !== "string") return null;
    const at = line.indexOf(":");
    if (at <= 0) return null;
    const day = line.slice(0, at).trim();
    const hours = line.slice(at + 1).trim();
    return day && hours ? { day, hours } : null;
  });
  return rows.length && rows.every(Boolean) ? (rows as OpeningDay[]) : null;
}

function fromPeriods(periods: unknown[]): OpeningDay[] | null {
  if (!periods.length || !periods.every(isObject)) return null;
  const list = periods as Period[];
  if (!list.every((p) => p.open && Number.isInteger(p.open.day) && p.open.day! >= 0 && p.open.day! <= 6)) return null;
  // One period that opens and never closes: always open
  if (list.length === 1 && !list[0].close) return WEEK.map((d) => ({ day: DAYS[d], hours: "Open 24 hours" }));
  return WEEK.map((d) => {
    const spans = list
      .filter((p) => p.open!.day === d)
      .sort((a, b) => (a.open!.hour ?? 0) * 60 + (a.open!.minute ?? 0) - ((b.open!.hour ?? 0) * 60 + (b.open!.minute ?? 0)))
      .map((p) => (p.close ? `${time(p.open!)}–${time(p.close)}` : `From ${time(p.open!)}`));
    return { day: DAYS[d], hours: spans.length ? spans.join(", ") : "Closed" };
  });
}

/** The day rows of stored opening hours; null when there are none or they cannot be read */
export function openingHoursRows(value: unknown): OpeningDay[] | null {
  const hours = isObject(value) && isObject(value.regularOpeningHours) ? value.regularOpeningHours : value;
  if (!isObject(hours)) return null;
  if (Array.isArray(hours.weekdayDescriptions)) {
    const rows = fromDescriptions(hours.weekdayDescriptions);
    if (rows) return rows;
  }
  if (Array.isArray(hours.periods)) return fromPeriods(hours.periods);
  return null;
}
