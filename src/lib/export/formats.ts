export type ExportFormat = "csv" | "tsv" | "parquet" | "md" | "json";

/**
 * One format policy for the export menus and route: every kind in the same
 * four (SLN-894), the commonplace book also in Markdown. The Goodreads file is
 * Goodreads' own CSV.
 */
export function exportFormatsFor(entity: string): readonly ExportFormat[] {
  if (entity === "reading-notes") return ["csv", "tsv", "parquet", "json", "md"];
  if (entity === "goodreads") return ["csv"];
  return ["csv", "tsv", "parquet", "json"];
}

export const FORMAT_MIME: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  parquet: "application/vnd.apache.parquet",
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export const FORMAT_EXT: Record<ExportFormat, string> = {
  csv: ".csv",
  tsv: ".tsv",
  parquet: ".parquet",
  md: ".md",
  json: ".json",
};
