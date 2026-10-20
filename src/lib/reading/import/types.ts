import type { AbandonReason, ReadingDatePrecision, ReadingFormat, ReadingStatus, ReadingUnit } from "../constants";

/*
 * One data row of a reading history file, mapped from any format (SLN-450).
 * Stored whole in `reading_import_rows.data`: what is not imported today
 * (private notes, StoryGraph moods) stays for later steps. To-read rows go to
 * Up next (SLN-452).
 */

/** ebook_library: an e-book library's ratings and reads, made by a command (SLN-658), never uploaded */
export type ImportSource = "goodreads" | "storygraph" | "durtal" | "ebook_library";

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
  restore?: ReadingRestore;
  /** "Earlier read, date unknown" and the like */
  note?: string;
}

export interface ImportRow {
  kind: "readings" | "to_read" | "sessions" | "notes";
  /** Exact Durtal restore payload, never used by Goodreads/StoryGraph. */
  history?: HistoryPayload;
  durtalRestore?: true;
  rawCells?: Record<string, string>;
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
  /** A to-read row (SLN-452): its Up next key, built by goodreadsToReadKey or storygraphToReadKey */
  queueKey?: string | null;
  /** A to-read row's Date Added: Up next takes the rows oldest first */
  addedOn?: string | null;
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

export interface ReadingRestore {
  startPage: number | null; startPercent: number | null; startMinutes: number | null;
  currentPage: number | null; currentPercent: number | null; currentMinutes: number | null; currentChapter: string | null;
  source: string; locationId: string | null; lastReadAt: string | null; createdAt: string | null; updatedAt: string | null;
}
export type HistoryPayload = {
  entity: "sessions" | "notes";
  summary?: string;
  id: string; workId: string | null; readingId: string | null; readingSourceKey: string | null; editionId: string | null;
  source: string; createdAt: string | null; updatedAt: string | null;
  /** Column names exactly match persisted fields; timestamps stay strings with microseconds. */
  values: Record<string, string | number | boolean | null>;
};
export type EmptyImport = { kind: "empty"; entity: import("./formats").DurtalExportKind; source: "durtal"; rows: 0 };
