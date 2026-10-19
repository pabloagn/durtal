import type { ReadingFormat, ReadingUnit } from "./constants";
import { formatMinutes, percentOf, remapPosition, type ProgressInput } from "./positions";
import { durationWords } from "./timer";

/*
 * What a progress log will do, before it is saved (SLN-447): the new
 * position, the live line under the field, whether it moves the reading
 * back or reaches the end, and what to send. Pure, so the dialog and its
 * tests share it.
 */

export interface LogReading {
  editionId: string | null;
  unit: ReadingUnit;
  format?: ReadingFormat;
  totalPages: number | null;
  totalMinutes: number | null;
  currentPage: number | null;
  currentPercent: number | null;
  currentMinutes: number | null;
}

/** The edition a session is read in, when it is not the reading's own */
export interface SessionEdition {
  id: string;
  pageCount: number | null;
  totalMinutes: number | null;
  unit: ReadingUnit;
}

export interface LogPreview {
  percent: number | null;
  /** A page or minutes in the reading's own edition */
  page: number | null;
  minutes: number | null;
  behind: boolean;
  reachedEnd: boolean;
  line: string;
  /** "Logged p. 212" */
  done: string;
  /** A time entry on a non-audio reading with no audio length. */
  sessionMinutes?: number;
  send: { page?: number; percent?: number; minutes?: number; addPages?: number; addMinutes?: number; chapter?: string };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number | null) => (n === null ? "" : `${round2(n)}%`);

export function logPreview(reading: LogReading, input: ProgressInput | null, session: SessionEdition | null = null): LogPreview | null {
  if (!input) return null;
  const other = session && session.id !== reading.editionId ? session : null;
  const totals = other
    ? { totalPages: other.pageCount ?? reading.totalPages, totalMinutes: reading.totalMinutes }
    : { totalPages: reading.totalPages, totalMinutes: reading.totalMinutes };
  // Where the reading is now, in the session's edition
  const fromPage = other
    ? reading.currentPercent !== null && totals.totalPages
      ? Math.round((reading.currentPercent / 100) * totals.totalPages)
      : 0
    : (reading.currentPage ?? 0);
  const fromMinutes = reading.currentMinutes ?? 0;
  if ((input.kind === "minutes" || input.kind === "addMinutes") && !reading.totalMinutes
    && reading.unit !== "minutes" && reading.format !== "audio") {
    const duration = durationWords(input.minutes * 60);
    const place = [
      reading.currentPage !== null ? `p. ${reading.currentPage}` : null,
      reading.currentPercent !== null ? pct(reading.currentPercent) : null,
    ].filter(Boolean).join(" · ");
    return {
      percent: reading.currentPercent,
      page: reading.currentPage,
      minutes: reading.currentMinutes,
      sessionMinutes: input.minutes,
      behind: false,
      reachedEnd: false,
      line: `${duration} read · ${place ? `stays at ${place}` : "keeps your place"}`,
      done: `Logged ${duration}`,
      send: input.kind === "minutes" ? { minutes: input.minutes } : { addMinutes: input.minutes },
    };
  }
  if (input.kind === "chapter")
    return {
      percent: reading.currentPercent,
      page: reading.currentPage,
      minutes: reading.currentMinutes,
      behind: false,
      reachedEnd: false,
      line: `Chapter ${input.chapter}`,
      done: `Logged chapter ${input.chapter}`,
      send: { chapter: input.chapter },
    };
  let given: { page?: number; minutes?: number; percent?: number };
  let send: LogPreview["send"];
  if (input.kind === "addPages") {
    given = { page: fromPage + input.pages };
    send = { addPages: input.pages };
  } else if (input.kind === "addMinutes") {
    given = { minutes: fromMinutes + input.minutes };
    send = { addMinutes: input.minutes };
  } else if (input.kind === "page") {
    given = { page: input.page };
    send = { page: input.page };
  } else if (input.kind === "percent") {
    given = { percent: input.percent };
    send = { percent: input.percent };
  } else {
    given = { minutes: input.minutes };
    send = { minutes: input.minutes };
  }
  const percent = percentOf(given, input.kind === "page" && input.totalPages ? { totalPages: input.totalPages } : totals);
  const mine = remapPosition(percent, reading);
  const page = other ? mine.page : (given.page ?? mine.page);
  const minutes = other ? mine.minutes : (given.minutes ?? mine.minutes);
  const behind = percent !== null && reading.currentPercent !== null && percent < reading.currentPercent;
  const reachedEnd = percent !== null && percent >= 100;
  let line: string;
  let done: string;
  if (other) {
    const target = reading.unit === "pages" && page !== null && reading.totalPages ? `p. ${page} of ${reading.totalPages}` : pct(percent);
    line = `${pct(percent)} · the reading moves to ${target}`;
    done = `Logged ${pct(percent)}`;
  } else if (given.page !== undefined) {
    const since = given.page - (reading.currentPage ?? 0);
    const pageTotal = input.kind === "page" && input.totalPages ? input.totalPages : totals.totalPages;
    line = [
      // "250/480" also gives the page count: the line shows that one (SLN-932)
      `Page ${given.page}${pageTotal ? ` of ${pageTotal}` : ""}`,
      percent !== null ? pct(percent) : null,
      // Without a page total the session counts no pages (countedPagesSql), so the line promises none (SLN-1095)
      since > 0 && pageTotal ? `${since} ${since === 1 ? "page" : "pages"} since last time` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    done = `Logged p. ${given.page}`;
  } else if (given.minutes !== undefined) {
    const since = given.minutes - fromMinutes;
    line = [
      `${formatMinutes(given.minutes)}${totals.totalMinutes ? ` of ${formatMinutes(totals.totalMinutes)}` : ""}`,
      percent !== null ? pct(percent) : null,
      since > 0 ? `${since} min since last time` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    done = `Logged ${formatMinutes(given.minutes)}`;
  } else {
    line = [pct(percent), page !== null && reading.totalPages ? `p. ${page} of ${reading.totalPages}` : null].filter(Boolean).join(" · ");
    done = `Logged ${pct(percent)}`;
  }
  return { percent, page, minutes, behind, reachedEnd, line, done, send };
}

/** "This moves you back from p. 400 to p. 212", or from 83% to 44% */
export function moveBackText(reading: LogReading, preview: LogPreview) {
  const pages = reading.unit === "pages" && reading.currentPage !== null && preview.page !== null;
  return pages
    ? `This moves you back from p. ${reading.currentPage} to p. ${preview.page}`
    : `This moves you back from ${pct(reading.currentPercent)} to ${pct(preview.percent)}`;
}

/**
 * A page logged on a reading with no page total counts no pages, so the
 * dialog asks for the page count with it (SLN-1095). Not for a sitting in
 * another edition, nor when "212/480" already gives the count.
 */
export function asksPageTotal(reading: Pick<LogReading, "totalPages">, input: ProgressInput | null, session: SessionEdition | null = null): boolean {
  if (reading.totalPages || session || !input) return false;
  return (input.kind === "page" && !input.totalPages) || input.kind === "addPages";
}
