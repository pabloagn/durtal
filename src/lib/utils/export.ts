
export type { ExportFormat } from "@/lib/export/formats";
export { FORMAT_MIME, FORMAT_EXT } from "@/lib/export/formats";

/**
 * A text cell a spreadsheet would read as a formula: one that begins with
 * =, +, -, @, a tab or a carriage return. Exports write it with a leading '
 * (the reading importer strips it again, src/lib/reading/import/csv.ts).
 * Literal apostrophes before that prefix are escaped too, so the importer
 * removes exactly our extra quote. Numbers are never changed: -2 stays -2.
 */
const FORMULA_START = /^'*[=+\-@\t\r]/;

function cellText(value: unknown, guard = true): string {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  // A typed row (SLN-894) reads in a spreadsheet as it always has: yes or no, nested data as JSON text
  if (typeof value === "boolean") return value ? "yes" : "no";
  const str = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  return guard && FORMULA_START.test(str) ? `'${str}` : str;
}

/**
 * A file another app imports rather than a spreadsheet opens (the Goodreads
 * file) goes out as stored: no formula guard, no byte order mark.
 */
export interface CsvOptions {
  forImport?: boolean;
}

/** A UTF-8 byte order mark, so Excel opens accents correctly; the importers skip it */
const BOM = "\uFEFF";

/**
 * Escape a value for CSV (RFC 4180): wrap in double-quotes if it contains
 * a comma, double-quote, or newline. Double-quotes inside the value are doubled.
 */
function escapeCSV(value: unknown, guard = true): string {
  const str = cellText(value, guard);
  if (/[,"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeTSV(value: unknown): string {
  const str = cellText(value);
  // The same quoting rule as CSV, with tabs as the separator. Keep text intact.
  return /[\t\n\r"]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Convert an array of flat objects to a CSV string, with a byte order mark.
 * With `headers`, those columns in that order, and the header row even when
 * there are no rows; without, the first row's keys, and "" for no rows.
 */
export function toCSV(rows: Record<string, unknown>[], headers?: readonly string[], { forImport = false }: CsvOptions = {}): string {
  if (rows.length === 0 && !headers) return "";
  const columns = headers ?? Object.keys(rows[0]);
  const cell = (value: unknown) => escapeCSV(value, !forImport);
  const lines = [
    columns.map(cell).join(","),
    ...rows.map((row) => columns.map((h) => cell(row[h])).join(",")),
  ];
  return (forImport ? "" : BOM) + lines.join("\n");
}

/**
 * Convert an array of flat objects to a TSV string, with a byte order mark;
 * `headers` as for toCSV.
 */
export function toTSV(rows: Record<string, unknown>[], headers?: readonly string[]): string {
  if (rows.length === 0 && !headers) return "";
  const columns = headers ?? Object.keys(rows[0]);
  const lines = [
    columns.map(escapeTSV).join("\t"),
    ...rows.map((row) => columns.map((h) => escapeTSV(row[h])).join("\t")),
  ];
  return BOM + lines.join("\n");
}

export { nativeJSON as toJSON } from "@/lib/export/native";
export { nativeParquet as toParquet } from "@/lib/export/parquet";
