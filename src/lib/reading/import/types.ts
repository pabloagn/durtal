import type { AbandonReason, ReadingDatePrecision, ReadingFormat, ReadingStatus, ReadingUnit } from "../constants";

/*
 * One data row of a reading history file, mapped from any format (SLN-450).
 * Stored whole in `reading_import_rows.data`: what is not imported today
 * (private notes, to-read rows, StoryGraph moods) stays for later steps.
 */

export type ImportSource = "goodreads" | "storygraph" | "durtal";

export interface ImportReading {
  /** Its number among the row's reads: 1 for the first */
  n: number;
  status: ReadingStatus;
  startedOn: string | null;
  startedPrecision: ReadingDatePrecision;
  finishedOn: string | null;
  finishedPrecision: ReadingDatePrecision;
  format: ReadingFormat;
  unit: ReadingUnit;
  totalPages: number | null;
  totalMinutes: number | null;
  position: { page?: number | null; percent?: number | null; minutes?: number | null; chapter?: string | null } | null;
  rating: number | null;
  reviewHtml: string | null;
  abandonReason: AbandonReason | null;
  abandonNote: string | null;
  /** Durtal files only: the reading the row was exported from */
  readingId: string | null;
  sourceKey: string;
  /** "Earlier read, date unknown" and the like */
  note?: string;
}

export interface ImportRow {
  kind: "readings" | "to_read";
  /** The file's own book id (Goodreads Book Id) */
  sourceBookId: string | null;
  title: string;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  /** The row's rating as the file has it (StoryGraph quarter stars kept) */
  fileRating: number | null;
  /** The rating a reading and the book would get: half stars */
  rating: number | null;
  reviewHtml: string | null;
  shelves: string[];
  privateNotes: string | null;
  /** Number of Pages, Year Published and the like, for the commit and the enrichment epic */
  pages: number | null;
  /** StoryGraph moods, pace, tags and the like: kept, not imported */
  extras: Record<string, string>;
  /** Durtal files: the book, edition and copy ids the row names */
  workId: string | null;
  editionId: string | null;
  instanceId: string | null;
  readings: ImportReading[];
  warnings: string[];
  /** Why the row cannot be imported at all (a date rule broken, a bad value) */
  error: string | null;
}

export interface ParsedFile {
  source: ImportSource;
  rows: ImportRow[];
  /** What the file's columns cannot carry, for the preview's box */
  missing: string[];
}
