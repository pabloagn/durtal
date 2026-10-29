import type { ImportSource } from "./types";
import { DURTAL_READING_COLUMNS } from "./durtal-format";
import { DURTAL_EXPORT_HEADERS_V2 } from "@/lib/export/columns";

export const DELIMITED_IMPORT_MESSAGE = "Choose a CSV or TSV file: a Goodreads, StoryGraph or Durtal reading export";

/** Browser-provided MIME types vary; the parser still identifies the contents. */
export function delimitedUploadFormat(name: string, mime = ""): "csv" | "tsv" | null {
  const extension = /\.(csv|tsv)$/i.exec(name)?.[1].toLowerCase();
  if (extension !== "csv" && extension !== "tsv") return null;
  const type = mime.toLowerCase().split(";", 1)[0].trim();
  return ["", "text/csv", "application/csv", "text/tab-separated-values", "text/tsv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"].includes(type)
    ? extension : null;
}

export const IMPORT_UPLOAD_MESSAGE = "Choose a CSV or TSV reading history, or an empty JSON or Parquet export";

/** Native exports are accepted only when empty; populated histories still use CSV/TSV. */
export function importUploadFormat(name: string, mime = ""): "csv" | "tsv" | "json" | "parquet" | null {
  const delimited = delimitedUploadFormat(name, mime);
  if (delimited) return delimited;
  const extension = /\.(json|parquet)$/i.exec(name)?.[1].toLowerCase();
  const type = mime.toLowerCase().split(";", 1)[0].trim();
  if (extension === "json" && ["", "application/json", "text/json", "text/plain", "application/octet-stream"].includes(type)) return "json";
  if (extension === "parquet" && ["", "application/vnd.apache.parquet", "application/parquet", "application/octet-stream"].includes(type)) return "parquet";
  return null;
}

/** The full Goodreads export header, in Goodreads' order: the fixtures and a later step's export use it */
export const GOODREADS_EXPORT_HEADER = [
  "Book Id",
  "Title",
  "Author",
  "Author l-f",
  "Additional Authors",
  "ISBN",
  "ISBN13",
  "My Rating",
  "Average Rating",
  "Publisher",
  "Binding",
  "Number of Pages",
  "Year Published",
  "Original Publication Year",
  "Date Read",
  "Date Added",
  "Bookshelves",
  "Bookshelves with positions",
  "Exclusive Shelf",
  "My Review",
  "Spoiler",
  "Private Notes",
  "Read Count",
  "Owned Copies",
] as const;

/** A file refused whole, with the reason the upload page shows */
export class ImportFileError extends Error {}

export type DurtalExportKind = keyof typeof DURTAL_EXPORT_HEADERS_V2;

export const DURTAL_FILE_NAMES: Record<DurtalExportKind, string> = {
  works: "books", authors: "people", films: "films", perfumes: "perfumes", paintings: "paintings",
  readings: "readings", "reading-sessions": "sessions", "reading-notes": "quotes and notes",
};

/** Complete known headers may be reordered or carry extra versioned columns. */
export function detectDurtalExport(headers: readonly string[]): DurtalExportKind | null {
  const present = new Set(headers);
  const found = (Object.keys(DURTAL_EXPORT_HEADERS_V2) as DurtalExportKind[])
    .filter((kind) => DURTAL_EXPORT_HEADERS_V2[kind].every((column) => present.has(column)));
  if (found.length > 1) throw new ImportFileError("This file combines different Durtal export headers");
  return found[0] ?? (DURTAL_READING_COLUMNS.every((column) => present.has(column)) ? "readings" : null);
}

export class UnsupportedDurtalExportError extends ImportFileError {
  constructor(public readonly kind: Exclude<DurtalExportKind, "readings">) {
    const name = DURTAL_FILE_NAMES[kind];
    super(kind === "reading-sessions" || kind === "reading-notes"
      ? `This is Durtal's ${name} file. Importing ${name} is not available here yet.`
      : `This is Durtal's ${name} file. Only reading history imports here.`);
  }
}

export class UnknownFormatError extends ImportFileError {
  constructor(headers: string[]) {
    const shown = headers.slice(0, 12).map((h) => h.slice(0, 40)).join(", ");
    super(`This file is not a Goodreads, StoryGraph or Durtal export. Its columns: ${shown || "none"}`);
  }
}

/** The file's format by its header names, never by column position */
export function detectFormat(headers: string[]): ImportSource {
  const has = (...names: string[]) => names.every((n) => headers.includes(n));
  const kind = detectDurtalExport(headers);
  if (kind && kind !== "readings" && kind !== "reading-sessions" && kind !== "reading-notes") throw new UnsupportedDurtalExportError(kind);
  if (kind) return "durtal";
  if (has("work_id", "source_key")) return "durtal";
  if (has("Title", "Exclusive Shelf", "My Rating")) return "goodreads";
  if (has("Read Status", "Star Rating")) return "storygraph";
  throw new UnknownFormatError(headers);
}
