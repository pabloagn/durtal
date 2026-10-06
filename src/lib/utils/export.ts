/* eslint-disable @typescript-eslint/no-explicit-any */
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import { Writable } from "stream";

export type ExportFormat = "csv" | "tsv" | "parquet" | "md";

/**
 * A text cell a spreadsheet would read as a formula: one that begins with
 * =, +, -, @, a tab or a carriage return. Exports write it with a leading '
 * (the reading importer strips it again, src/lib/reading/import/csv.ts).
 * Numbers are never changed: -2 stays -2.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function cellText(value: unknown, guard = true): string {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  const str = String(value);
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
  // Tabs and newlines replaced with spaces
  return str.replace(/[\t\n\r]/g, " ");
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
 * Convert an array of flat objects to a TSV string; `headers` as for toCSV.
 */
export function toTSV(rows: Record<string, unknown>[], headers?: readonly string[]): string {
  if (rows.length === 0 && !headers) return "";
  const columns = headers ?? Object.keys(rows[0]);
  const lines = [
    columns.map(escapeTSV).join("\t"),
    ...rows.map((row) => columns.map((h) => escapeTSV(row[h])).join("\t")),
  ];
  return lines.join("\n");
}

/**
 * Convert an array of flat objects to a Parquet buffer.
 * All fields are stored as UTF8 strings for simplicity and portability.
 */
export async function toParquet(
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  if (rows.length === 0) return Buffer.alloc(0);

  const headers = Object.keys(rows[0]);

  // Build Parquet schema — all fields as optional UTF8 strings
  const schemaFields: Record<string, any> = {};
  for (const h of headers) {
    schemaFields[h] = { type: "UTF8", optional: true };
  }
  const schema = new ParquetSchema(schemaFields);

  // Write to an in-memory buffer via a custom Writable stream
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      chunks.push(chunk);
      callback();
    },
  });

  const writer = await ParquetWriter.openStream(schema, writable as any);
  for (const row of rows) {
    const record: Record<string, string | null> = {};
    for (const h of headers) {
      record[h] = row[h] == null ? null : String(row[h]);
    }
    await writer.appendRow(record);
  }
  await writer.close();

  return Buffer.concat(chunks);
}

/**
 * MIME types for each export format.
 */
export const FORMAT_MIME: Record<ExportFormat, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  parquet: "application/vnd.apache.parquet",
  md: "text/markdown; charset=utf-8",
};

/**
 * File extensions for each export format.
 */
export const FORMAT_EXT: Record<ExportFormat, string> = {
  csv: ".csv",
  tsv: ".tsv",
  parquet: ".parquet",
  md: ".md",
};
