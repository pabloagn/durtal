import { DURTAL_READING_COLUMNS } from "@/lib/reading/import/durtal-format";

/** Columns after the Durtal reading CSV's: the importer ignores them */
export const READING_READ_ONLY_COLUMNS = [
  "edition_title",
  "edition_language",
  "translators",
  "copy_location",
  "session_count",
  "minutes_read",
  "pages_read",
] as const;

/** The readings file: exactly the Durtal reading CSV, then the read-only columns */
export const READING_EXPORT_COLUMNS = [...DURTAL_READING_COLUMNS, ...READING_READ_ONLY_COLUMNS] as const;

export const SESSION_EXPORT_COLUMNS = [
  "session_id",
  "reading_id",
  "work_title",
  "day",
  "started_at",
  "ended_at",
  "time_zone",
  "duration_seconds",
  "start_page",
  "end_page",
  "start_percent",
  "end_percent",
  "start_minutes",
  "end_minutes",
  "end_chapter",
  "pages_counted",
  "edition_title",
  "format",
  "source",
] as const;

export const NOTE_EXPORT_COLUMNS = [
  "note_id",
  "work_id",
  "title",
  "authors",
  "kind",
  "body",
  "thought",
  "page",
  "end_page",
  "page_roman",
  "chapter",
  "percent",
  "favourite",
  "reading_id",
  "edition_id",
  "edition_label",
  "edition_title",
  "translators",
  "source",
  "created_at",
] as const;

