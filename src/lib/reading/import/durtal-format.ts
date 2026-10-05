/**
 * The Durtal reading CSV's columns, in order (SLN-450). The one list: the
 * importer reads it, the seed step writes it, and the export of a later step
 * writes exactly these columns, so an export imports back unchanged.
 * `authors` is the author names joined with "; ".
 */
export const DURTAL_READING_COLUMNS = [
  "reading_id",
  "work_id",
  "edition_id",
  "instance_id",
  "title",
  "authors",
  "isbn13",
  "status",
  "format",
  "unit",
  "total_pages",
  "total_minutes",
  "start_page",
  "current_page",
  "current_percent",
  "current_minutes",
  "current_chapter",
  "started_on",
  "started_precision",
  "finished_on",
  "finished_precision",
  "rating",
  "review_html",
  "abandon_reason",
  "abandon_note",
  "source_key",
] as const;

export type DurtalReadingColumn = (typeof DURTAL_READING_COLUMNS)[number];
