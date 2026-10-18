import { formatReadingSpan } from "../dates";
import { ANYWAY_REASONS, type ImportMatch, type ImportSection, type ReadingVerdict } from "./match-rules";
import type { ImportReading, ImportSource } from "./types";

/*
 * The preview's words (SLN-450): what the file says, what the commit will
 * write, the book rating line, the summary, the commit button and the box of
 * what the file cannot carry. Pure, so the page and the tests share them.
 */

const n = (count: number) => count.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const stars = (r: number) => `${r} ${r === 1 ? "star" : "stars"}`;

export const SOURCE_LABELS: Record<ImportSource, string> = { goodreads: "Goodreads", storygraph: "StoryGraph", durtal: "Durtal", ebook_library: "E-book library" };

type Reading = Pick<ImportReading, "status" | "startedOn" | "startedPrecision" | "finishedOn" | "finishedPrecision" | "rating" | "note"> & { hasReview?: boolean };

/** "Finished 14 Apr 2019", "Reading, started 2 Oct", "Abandoned, 3 to 14 Apr 2019", "Abandoned, date unknown" */
export function readingWords(r: Reading, today: string): string {
  const span = formatReadingSpan(r, today);
  if (r.status === "reading" || r.status === "paused") {
    const label = r.status === "reading" ? "Reading" : "Paused";
    return span === "Dates unknown" ? label : `${label}, ${span.charAt(0).toLowerCase()}${span.slice(1)}`;
  }
  if (r.status === "abandoned") {
    if (span === "Dates unknown") return "Abandoned, date unknown";
    // A one-date or cross-period read has no "Stopped" to swap: "Abandoned, 3 to 14 Apr 2019" (SLN-1099)
    return span.startsWith("Stopped ") ? span.replace(/^Stopped/, "Abandoned") : `Abandoned, ${span}`;
  }
  return span === "Dates unknown" ? "Finished, date unknown" : span;
}

/**
 * What the file says: the author, the latest read and the rating as the file
 * has it. A rating past five stars is shown as it will be saved (SLN-955)
 */
export function fileLine(row: { authors: string[]; fileRating: number | null; readings: Reading[]; kind: string }, today: string): string {
  const latest = row.readings.at(-1);
  return [
    row.authors[0],
    row.kind === "to_read" ? "Want to read" : latest ? readingWords(latest, today) : null,
    row.readings.length > 1 ? `${row.readings.length} reads` : null,
    row.fileRating !== null ? stars(Math.min(row.fileRating, 5)) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What the commit will write: the latest new read in full, the other new
 * reads counted, and the reads already in Durtal counted.
 * "Finished 14 Apr 2019 · 4 stars · review · +2 earlier reads, dates unknown"
 */
export function writeLine(readings: Reading[], verdicts: ReadingVerdict[], today: string, { anyway = false } = {}): string | null {
  const isNew = (i: number) => verdicts[i]?.verdict === "new" || (anyway && ANYWAY_REASONS.includes(verdicts[i]?.reason ?? null));
  const fresh = readings.filter((_, i) => isNew(i));
  const presentIdx = readings.map((_, i) => i).filter((i) => verdicts[i]?.verdict === "already_present" && !isNew(i));
  const present = presentIdx.length;
  const presentWord = presentIdx.every((i) => verdicts[i].reason === "Undated read") ? "earlier read" : "read";
  // An e-book library's read beside Durtal's own (SLN-658): not the same read, and not written
  const beside = presentIdx.some((i) => verdicts[i].reason === "Another read in Durtal" || verdicts[i].reason === "Being read in Durtal");
  if (!fresh.length) return beside ? "Durtal's own reading kept: the library's read is not imported" : present ? `${plural(present, presentWord)} already in Durtal` : null;
  const latest = fresh.at(-1)!;
  const earlier = fresh.slice(0, -1);
  const undated = earlier.filter((r) => !r.finishedOn && !r.startedOn).length;
  const parts = [
    readingWords(latest, today),
    latest.rating !== null ? stars(latest.rating) : null,
    latest.hasReview ? "review" : null,
    undated === earlier.length && undated
      ? `+${plural(undated, "earlier read")}, ${undated === 1 ? "date" : "dates"} unknown`
      : earlier.length
        ? `+${plural(earlier.length, "earlier read")}`
        : null,
    present ? `${plural(present, presentWord)} already in Durtal` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The book rating line: set, kept, replaced, or nothing when equal or nothing is written */
export function ratingLine(input: {
  section: ImportSection;
  fileRating: number | null;
  bookRating: number | null | undefined;
  useFileRating: boolean;
  writes: boolean;
}): { text: string; choice: boolean } | null {
  const { section, fileRating, bookRating, useFileRating, writes } = input;
  if (fileRating === null || bookRating === undefined || !writes) return null;
  if (section === "present" || section === "cannot" || section === "not_imported" || section === "to_read") return null;
  if (bookRating === null) return { text: `Book rating set to ${fileRating}: the book has none`, choice: false };
  if (bookRating === fileRating) return null;
  return useFileRating
    ? { text: `Book rating ${bookRating} replaced by ${fileRating}`, choice: true }
    : { text: `Book rating ${bookRating} kept (the file says ${fileRating})`, choice: true };
}

/** "Add this book": the ISBN when the row has one, else the title and first author */
export function addBookHref(row: { isbn13: string | null; title: string; authors: string[] }): string {
  if (row.isbn13) return `/library/new?isbn=${row.isbn13}`;
  const q = [row.title, row.authors[0]].filter(Boolean).join(" ").slice(0, 200);
  return `/library/new?${new URLSearchParams({ q }).toString()}`;
}

export interface SummaryCounts {
  rows: number;
  sections: Record<ImportSection, number>;
  wantToRead: number;
  ratingsDiffer: number;
}

/** "1,204 rows · 980 exact · 120 likely · 60 to choose · 44 not in Durtal · 412 want to read · 18 already in Durtal · 6 book ratings differ" */
export function summaryLine(s: SummaryCounts): string {
  return [
    plural(s.rows, "row"),
    s.sections.exact ? `${n(s.sections.exact)} exact` : null,
    s.sections.likely ? `${n(s.sections.likely)} likely` : null,
    s.sections.choose ? `${n(s.sections.choose)} to choose` : null,
    s.sections.none ? `${n(s.sections.none)} not in Durtal` : null,
    s.wantToRead ? `${n(s.wantToRead)} want to read` : null,
    s.sections.present ? `${n(s.sections.present)} already in Durtal` : null,
    s.sections.cannot ? `${n(s.sections.cannot)} cannot be imported` : null,
    s.ratingsDiffer ? `${plural(s.ratingsDiffer, "book rating")} ${s.ratingsDiffer === 1 ? "differs" : "differ"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The commit button and the line under it: readings, private notes (SLN-453), books for Up next (SLN-452) */
export function commitWords(toImport: number, pending: number, toQueue = 0, toNotes = 0, toRate = 0): { label: string; note: string | null } {
  const imported = [toImport ? plural(toImport, "reading") : null, toNotes ? plural(toNotes, "note") : null, toRate ? plural(toRate, "rating") : null].filter(Boolean);
  const queue = toQueue ? `add ${plural(toQueue, "book")} to Up next` : null;
  return {
    label: imported.length
      ? `Import ${imported.length > 2 ? `${imported.slice(0, -1).join(", ")} and ${imported[imported.length - 1]}` : imported.join(" and ")}${queue ? `${imported.length > 1 ? "," : ""} and ${queue}` : ""}`
      : queue
        ? `Add ${plural(toQueue, "book")} to Up next`
        : "Nothing to import",
    note: pending ? `${plural(pending, "row")} not decided yet ${pending === 1 ? "is" : "are"} left out` : null,
  };
}

/** "What this file cannot carry", for the detected format */
export function cannotCarry(source: ImportSource, counts: { otherShelves: number; extras: number }, missing: string[]): string[] {
  const lines: string[] = [];
  if (source === "goodreads") {
    lines.push("Goodreads keeps no start dates: imported reads start on an unknown date.");
    lines.push("Goodreads keeps only the last read date: earlier reads have no dates.");
  }
  if (source === "storygraph") lines.push("Quarter stars are rounded to the nearest half: 3.75 is saved as 4, 3.25 as 3.5.");
  if (source === "durtal") lines.push("A reading CSV holds readings only: no sessions, notes or quotes.");
  if (source === "ebook_library") {
    lines.push("Only the library's books that are e-books in Durtal, linked to their books, are here.");
    lines.push("The library keeps no start dates and one read a book: a reread is not imported.");
  }
  if (counts.otherShelves)
    lines.push(`${plural(counts.otherShelves, "book")} on ${counts.otherShelves === 1 ? "a shelf that is" : "shelves that are"} neither read nor to-read ${counts.otherShelves === 1 ? "is" : "are"} kept but not imported.`);
  if (counts.extras) lines.push(`Moods, pace, character questions, content warnings and tags of ${plural(counts.extras, "book")} are kept but not imported.`);
  return [...lines, ...missing];
}

/** A written row's outcome per read */
export function outcomeWords(outcome: "written" | "already_present" | "possible_duplicate" | "refused", reason: string | null): string {
  if (outcome === "written") return "Written";
  if (outcome === "already_present") return reason ? `Already in Durtal (${reason})` : "Already in Durtal";
  if (outcome === "possible_duplicate") return "Possible duplicate, not written";
  return `Refused: ${reason ?? "not written"}`;
}

/** The reason a row shows: "Same ISBN", "Title and author, 92%", "Chosen by you" */
export function reasonWords(match: Pick<ImportMatch, "reason" | "chosen" | "section" | "note">): string | null {
  if (match.section === "cannot" || match.section === "present") return match.note;
  // A to-read book: how it was found, and where it stands in Up next (SLN-452)
  if (match.section === "to_read") return [match.chosen ? "Chosen by you" : match.reason, match.note].filter(Boolean).join(" · ") || null;
  if (match.chosen) return "Chosen by you";
  return match.reason;
}
