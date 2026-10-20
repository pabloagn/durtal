/* eslint-disable @typescript-eslint/no-explicit-any */
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import { Writable } from "stream";

export type { ExportFormat } from "@/lib/export/formats";
export { FORMAT_MIME, FORMAT_EXT } from "@/lib/export/formats";

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

/**
 * A row as JSON and Parquet write it (SLN-894): `headers`' columns in order
 * (else the row's own), a missing value, which the spreadsheet rows write as
 * "", as null, and a Date as its ISO instant.
 */
export function typedRow(row: Record<string, unknown>, headers?: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    (headers ?? Object.keys(row)).map((h) => {
      const value = row[h];
      return [h, value === "" || value === undefined ? null : value instanceof Date ? value.toISOString() : value];
    }),
  );
}

/** The JSON file: an array of typed rows */
export function toJSON(rows: Record<string, unknown>[], headers?: readonly string[]): string {
  return JSON.stringify(rows.map((row) => typedRow(row, headers)));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
/** Columns that hold fractions even when every value in one file is whole */
const FRACTIONAL = /(^|_)(rating|percent|cm)$/;

type ParquetType = "BOOLEAN" | "INT64" | "DOUBLE" | "DATE" | "TIMESTAMP_MILLIS" | "JSON" | "UTF8";

/** A column's Parquet type from its values; a column of mixed kinds, or of nulls only, is text */
function columnType(name: string, values: unknown[]): ParquetType {
  const present = values.filter((v) => v != null);
  if (!present.length) return "UTF8";
  if (present.every((v) => typeof v === "boolean")) return "BOOLEAN";
  if (present.every((v) => typeof v === "number" && Number.isFinite(v)))
    return !FRACTIONAL.test(name) && present.every((v) => Number.isInteger(v)) ? "INT64" : "DOUBLE";
  if (present.every((v) => typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(v)))) return "DATE";
  if (present.every((v) => typeof v === "string" && INSTANT.test(v) && !Number.isNaN(Date.parse(v)))) return "TIMESTAMP_MILLIS";
  if (present.every((v) => typeof v === "object")) return "JSON";
  return "UTF8";
}

function parquetValue(type: ParquetType, value: unknown): unknown {
  if (value == null) return null;
  if (type === "INT64") return BigInt(value as number);
  if (type === "DATE" || type === "TIMESTAMP_MILLIS") return new Date(value as string);
  if (type === "UTF8") return cellText(value, false);
  // The writer reads a bare array as a repeated column's values: wrapped, it is one JSON value
  if (type === "JSON") return [value];
  return value;
}

/**
 * Convert an array of objects to a Parquet buffer (SLN-894): each column
 * typed from its values (whole numbers, numbers, yes or no, days, instants,
 * nested data, else text), a missing value null. With `headers`, those
 * columns in that order, and a file with its schema even when there are no
 * rows; without, the first row's keys.
 */
export async function toParquet(
  rows: Record<string, unknown>[],
  headers?: readonly string[],
): Promise<Buffer> {
  if (rows.length === 0 && !headers) return Buffer.alloc(0);

  const columns = headers ?? Object.keys(rows[0]);
  const typed = rows.map((row) => typedRow(row, columns));
  const types = new Map(columns.map((h) => [h, columnType(h, typed.map((row) => row[h]))]));

  const schemaFields: Record<string, any> = {};
  for (const h of columns) {
    schemaFields[h] = { type: types.get(h), optional: true };
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
  for (const row of typed) {
    const record: Record<string, unknown> = {};
    for (const h of columns) {
      record[h] = parquetValue(types.get(h)!, row[h]);
    }
    await writer.appendRow(record);
  }
  await writer.close();

  return Buffer.concat(chunks);
}
