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

export const BOOK_EXPORT_COLUMNS = [
  "title", "ebook_formats", "authors", "original_language", "original_year", "catalogue_status", "acquisition_priority", "rating",
  "is_anthology", "isbn_13", "isbn_10", "publisher", "acquisition_targets", "edition_publishers", "imprint", "publication_year",
  "edition_language", "binding", "page_count", "edition_count", "instance_count", "notes",
] as const;
export const PEOPLE_EXPORT_COLUMNS = [
  "name", "sort_name", "first_name", "last_name", "real_name", "roles", "nationality", "gender", "birth_year", "birth_month", "birth_day",
  "death_year", "death_month", "death_day", "bio", "website", "works_count",
] as const;
export const FILM_EXPORT_COLUMNS = [
  "title", "original_title", "directors", "writers", "cast", "released", "runtime", "countries", "languages", "genres", "physical_copies", "digital_copies", "rating", "favourite", "notes", "description",
] as const;
export const PERFUME_EXPORT_COLUMNS = [
  "title", "houses", "manufacturers", "perfumers", "released", "concentrations", "families", "accords", "top_notes", "heart_notes", "base_notes", "other_notes", "bottles", "samples", "decants", "rating", "favourite", "notes", "description",
] as const;
export const PAINTING_EXPORT_COLUMNS = [
  "title", "painters", "painted", "movements", "genres", "techniques", "media", "supports", "original", "original_owner", "height_cm", "width_cm", "objects_owned", "rating", "favourite", "notes", "description",
] as const;

/** Shared header identities for the eight Durtal table exports. */
export const DURTAL_EXPORT_HEADERS = {
  works: BOOK_EXPORT_COLUMNS, authors: PEOPLE_EXPORT_COLUMNS, films: FILM_EXPORT_COLUMNS,
  perfumes: PERFUME_EXPORT_COLUMNS, paintings: PAINTING_EXPORT_COLUMNS, readings: READING_EXPORT_COLUMNS,
  "reading-sessions": SESSION_EXPORT_COLUMNS, "reading-notes": NOTE_EXPORT_COLUMNS,
} as const;
