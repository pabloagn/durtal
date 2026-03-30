/* eslint-disable @typescript-eslint/no-explicit-any */
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import { Writable } from "stream";

export type ExportFormat = "csv" | "tsv" | "parquet";

/**
 * Escape a value for CSV (RFC 4180): wrap in double-quotes if it contains
 * a comma, double-quote, or newline. Double-quotes inside the value are doubled.
 */
function escapeCSV(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeTSV(value: unknown): string {
  const str = value == null ? "" : String(value);
  // Tabs and newlines replaced with spaces
  return str.replace(/[\t\n\r]/g, " ");
}

/**
 * Convert an array of flat objects to CSV string.
 */
export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => headers.map((h) => escapeCSV(row[h])).join(",")),
  ];
  return lines.join("\n");
}

/**
 * Convert an array of flat objects to TSV string.
 */
export function toTSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeTSV).join("\t"),
    ...rows.map((row) => headers.map((h) => escapeTSV(row[h])).join("\t")),
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
};

/**
 * File extensions for each export format.
 */
export const FORMAT_EXT: Record<ExportFormat, string> = {
  csv: ".csv",
  tsv: ".tsv",
  parquet: ".parquet",
};
