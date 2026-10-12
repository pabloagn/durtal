export type ExportFormat = "csv" | "tsv" | "parquet" | "md" | "json";

/** One format policy for the export menus and route; JSON is additive for books. */
export function exportFormatsFor(entity: string): readonly ExportFormat[] {
  if (entity === "works") return ["csv", "tsv", "parquet", "json"];
  if (entity === "reading-notes") return ["csv", "tsv", "parquet", "md"];
  if (entity === "goodreads") return ["csv"];
  return ["csv", "tsv", "parquet"];
}

export const FORMAT_MIME: Record<ExportFormat, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
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
