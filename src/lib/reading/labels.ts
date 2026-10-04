import type { ReadingDatePrecision, ReadingStatus, ReadingUnit } from "./constants";
import { formatReadingDate } from "./dates";
import { formatMinutes } from "./positions";

/*
 * The words of the book page's reading control and section (SLN-447). Pure:
 * the header control, the section and their tests share them.
 */

export interface ReadingSummary {
  id: string;
  status: ReadingStatus;
  unit: ReadingUnit;
  currentPage: number | null;
  currentPercent: number | null;
  currentMinutes: number | null;
  totalPages: number | null;
  totalMinutes: number | null;
  finishedOn: string | null;
  finishedPrecision: ReadingDatePrecision;
}

export type BookReadingState = "unread" | "reading" | "paused" | "read" | "abandoned";

/** The open reading, else the book's derived state */
export function bookReadingState(readings: Pick<ReadingSummary, "status">[]): BookReadingState {
  if (readings.some((r) => r.status === "reading")) return "reading";
  if (readings.some((r) => r.status === "paused")) return "paused";
  if (readings.some((r) => r.status === "finished")) return "read";
  if (readings.some((r) => r.status === "abandoned")) return "abandoned";
  return "unread";
}

const percent = (r: Pick<ReadingSummary, "currentPercent">) => `${Math.round(r.currentPercent ?? 0)}%`;

/** "p. 212 of 480 · 44%", "44%", "3:12 of 9:40" */
export function positionText(r: Omit<ReadingSummary, "id" | "status" | "finishedOn" | "finishedPrecision">) {
  if (r.unit === "minutes" && r.currentMinutes !== null)
    return r.totalMinutes ? `${formatMinutes(r.currentMinutes)} of ${formatMinutes(r.totalMinutes)}` : formatMinutes(r.currentMinutes);
  if (r.unit === "pages" && r.currentPage !== null && r.totalPages)
    return `p. ${r.currentPage} of ${r.totalPages} · ${percent(r)}`;
  return percent(r);
}

/** Where an abandoned or paused reading stopped: "p. 120", else "44%" */
function stopText(r: ReadingSummary) {
  if (r.unit === "pages" && r.currentPage !== null) return `p. ${r.currentPage}`;
  if (r.unit === "minutes" && r.currentMinutes !== null) return formatMinutes(r.currentMinutes);
  return percent(r);
}

/** The latest finished reading, by its finish date */
function lastFinished(readings: ReadingSummary[]) {
  return readings
    .filter((r) => r.status === "finished")
    .sort((a, b) => (b.finishedOn ?? "").localeCompare(a.finishedOn ?? ""))[0];
}

/** The header control's label for the book's readings */
export function readingControlLabel(readings: ReadingSummary[]): string {
  const state = bookReadingState(readings);
  if (state === "unread") return "Start reading";
  if (state === "reading") return `Reading · ${positionText(readings.find((r) => r.status === "reading")!)}`;
  if (state === "paused") return `Paused at ${percent(readings.find((r) => r.status === "paused")!)}`;
  if (state === "read") {
    const times = readings.filter((r) => r.status === "finished").length;
    const last = lastFinished(readings);
    const when = last?.finishedOn && last.finishedPrecision !== "unknown" ? last.finishedOn : null;
    if (times === 1)
      return when ? `Read · ${formatReadingDate(when, last.finishedPrecision)}` : "Read";
    return when ? `Read ${times} times · ${when.slice(0, 4)}` : `Read ${times} times`;
  }
  const abandoned = readings.filter((r) => r.status === "abandoned").sort((a, b) => (b.finishedOn ?? "").localeCompare(a.finishedOn ?? ""))[0];
  return `Abandoned at ${stopText(abandoned)}`;
}

export type ReadingMenuAction =
  | "start"
  | "past"
  | "progress"
  | "pause"
  | "resume"
  | "finish"
  | "abandon"
  | "edit"
  | "reread"
  | "resumeAbandoned"
  | "startAgain";

/** The actions the header control offers in each state, in order */
export function readingMenu(state: BookReadingState): ReadingMenuAction[] {
  switch (state) {
    case "unread":
      return ["start", "past"];
    case "reading":
      return ["progress", "pause", "finish", "abandon", "edit"];
    case "paused":
      return ["resume", "progress", "finish", "abandon"];
    case "read":
      return ["reread", "past"];
    case "abandoned":
      return ["resumeAbandoned", "startAgain", "past"];
  }
}

export const READING_ACTION_LABELS: Record<ReadingMenuAction, string> = {
  start: "Start reading",
  past: "Log a past read",
  progress: "Log progress",
  pause: "Pause",
  resume: "Resume",
  finish: "Finish",
  abandon: "Abandon",
  edit: "Edit reading",
  reread: "Start a re-read",
  resumeAbandoned: "Resume this reading",
  startAgain: "Start again",
};

/** "1st read", "2nd read", "3rd read", "11th read" */
export function ordinalRead(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix} read`;
}

export interface RecordReading {
  status: ReadingStatus;
  startedOn: string | null;
  startedPrecision: ReadingDatePrecision;
  finishedOn: string | null;
  finishedPrecision: ReadingDatePrecision;
}

/** The record column's Reading group: first read, last finished, times read, time spent */
export function readingRecord(rows: { reading: RecordReading; totalSeconds: number }[]) {
  const dated = rows
    .flatMap((r): { date: string; precision: ReadingDatePrecision }[] =>
      r.reading.startedOn && r.reading.startedPrecision !== "unknown"
        ? [{ date: r.reading.startedOn, precision: r.reading.startedPrecision }]
        : r.reading.finishedOn && r.reading.finishedPrecision !== "unknown"
          ? [{ date: r.reading.finishedOn, precision: r.reading.finishedPrecision }]
          : [],
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const finished = rows
    .filter((r) => r.reading.status === "finished" && r.reading.finishedOn && r.reading.finishedPrecision !== "unknown")
    .sort((a, b) => b.reading.finishedOn!.localeCompare(a.reading.finishedOn!));
  const seconds = rows.reduce((sum, r) => sum + (r.totalSeconds || 0), 0);
  const hours = Math.floor(seconds / 3600),
    minutes = Math.round((seconds % 3600) / 60);
  return {
    firstRead: dated[0] ? formatReadingDate(dated[0].date, dated[0].precision) : null,
    lastFinished: finished[0] ? formatReadingDate(finished[0].reading.finishedOn, finished[0].reading.finishedPrecision) : null,
    timesRead: rows.filter((r) => r.reading.status === "finished").length,
    timeSpent: seconds > 0 ? (hours ? `${hours} h ${minutes} min` : `${minutes} min`) : null,
  };
}
