import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { stableStringify } from "@/lib/harmonization/normalize";

/*
 * What the interchange format knows about a table, read from its Drizzle
 * definition (SLN-375): the stored columns with their kinds, the primary key
 * and the foreign keys. Rows travel as Postgres writes them with `to_jsonb`:
 * snake_case column names, numbers as numbers, dates as text.
 */

export type ValueKind =
  | "uuid"
  | "text"
  | "integer"
  | "number"
  | "boolean"
  | "timestamp"
  | "date"
  | "json"
  | "text[]";

export interface ColumnSpec {
  name: string;
  kind: ValueKind;
  nullable: boolean;
  /** The values a text or enum column accepts, when it has a fixed list */
  values: readonly string[] | null;
}

export interface ForeignKeySpec {
  columns: string[];
  table: string;
  foreignColumns: string[];
}

export interface TableShape {
  name: string;
  /** Stored columns, without generated ones: the columns a file row carries */
  columns: ColumnSpec[];
  primaryKey: string[];
  foreignKeys: ForeignKeySpec[];
}

const KINDS: Record<string, ValueKind> = {
  PgUUID: "uuid",
  PgText: "text",
  PgVarchar: "text",
  PgEnumColumn: "text",
  PgSmallInt: "integer",
  PgInteger: "integer",
  PgBigInt53: "integer",
  PgNumeric: "number",
  PgNumericNumber: "number",
  PgDoublePrecision: "number",
  PgReal: "number",
  PgBoolean: "boolean",
  PgTimestamp: "timestamp",
  PgTimestampString: "timestamp",
  PgDateString: "date",
  PgDate: "date",
  PgJsonb: "json",
  PgJson: "json",
};

function columnKind(column: { columnType: string; baseColumn?: { columnType: string } }, table: string, name: string): ValueKind {
  if (column.columnType === "PgArray") {
    if (column.baseColumn && KINDS[column.baseColumn.columnType] === "text") return "text[]";
  } else if (KINDS[column.columnType]) return KINDS[column.columnType];
  throw new Error(`The interchange format cannot carry ${table}.${name} (${column.columnType})`);
}

/** The shape of one table, from its Drizzle definition */
export function tableShape(table: PgTable): TableShape {
  const config = getTableConfig(table);
  const columns = config.columns
    .filter((c) => !(c as { generated?: unknown }).generated)
    .map((c) => ({
      name: c.name,
      kind: columnKind(c as never, config.name, c.name),
      nullable: !c.notNull,
      values: (c as { enumValues?: readonly string[] }).enumValues?.length
        ? (c as { enumValues: readonly string[] }).enumValues
        : null,
    }));
  const primaryKey = config.primaryKeys.length
    ? config.primaryKeys[0].columns.map((c) => c.name)
    : config.columns.filter((c) => c.primary).map((c) => c.name);
  const foreignKeys = config.foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      columns: ref.columns.map((c) => c.name),
      table: getTableConfig(ref.foreignTable).name,
      foreignColumns: ref.foreignColumns.map((c) => c.name),
    };
  });
  return { name: config.name, columns, primaryKey, foreignKeys };
}

export type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * A timestamp in UTC with its microseconds kept: Postgres stores six decimal
 * places and a JavaScript Date only three, so the digits are carried as text.
 */
export function utcTimestamp(value: string): string | null {
  const m = TIMESTAMP.exec(value);
  if (!m) return null;
  const zone = m[4] === "Z" ? "Z" : m[4].length === 3 ? `${m[4]}:00` : m[4].includes(":") ? m[4] : `${m[4].slice(0, 3)}:${m[4].slice(3)}`;
  const at = new Date(`${m[1]}T${m[2]}${zone}`);
  if (Number.isNaN(at.getTime())) return null;
  const fraction = (m[3] ?? "").replace(/0+$/, "");
  return `${at.toISOString().slice(0, 19)}${fraction ? `.${fraction}` : ""}Z`;
}

/** Why a value does not fit its column, or null when it does */
function valueProblem(column: ColumnSpec, value: unknown): string | null {
  if (value === null) return column.nullable ? null : "is required";
  switch (column.kind) {
    case "uuid":
      return typeof value === "string" && UUID.test(value) ? null : "must be a UUID";
    case "text":
      if (typeof value !== "string") return "must be text";
      return column.values && !column.values.includes(value) ? `must be one of: ${column.values.join(", ")}` : null;
    case "integer":
      return Number.isSafeInteger(value) ? null : "must be a whole number";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "must be a number";
    case "boolean":
      return typeof value === "boolean" ? null : "must be true or false";
    case "timestamp":
      return typeof value === "string" && utcTimestamp(value) ? null : "must be a date and time";
    case "date":
      return typeof value === "string" && DATE.test(value) ? null : "must be a date (YYYY-MM-DD)";
    case "json":
      return null;
    case "text[]":
      return Array.isArray(value) && value.every((v) => typeof v === "string") ? null : "must be a list of text";
  }
}

/** Every problem of one file row: unknown or missing columns and values that do not fit */
export function rowProblems(shape: TableShape, row: unknown): string[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) return ["must be an object"];
  const problems: string[] = [];
  const known = new Set(shape.columns.map((c) => c.name));
  for (const key of Object.keys(row)) if (!known.has(key)) problems.push(`${key}: is not a column of ${shape.name}`);
  for (const column of shape.columns) {
    if (!(column.name in row)) {
      problems.push(`${column.name}: is missing`);
      continue;
    }
    const problem = valueProblem(column, (row as Row)[column.name]);
    if (problem) problems.push(`${column.name}: ${problem}`);
  }
  return problems;
}

/** A row as the file carries it: stored columns only, timestamps in UTC */
export function fileRow(shape: TableShape, row: Row): Row {
  const out: Row = {};
  for (const column of shape.columns) {
    const value = row[column.name] ?? null;
    out[column.name] = column.kind === "timestamp" && typeof value === "string" ? utcTimestamp(value) : value;
  }
  return out;
}

/** The primary key of a row, as one comparable string */
export function rowKey(shape: TableShape, row: Row): string {
  return shape.primaryKey.map((c) => String(row[c])).join("|");
}

/** The columns where two rows of one table differ */
export function differingColumns(shape: TableShape, a: Row, b: Row): string[] {
  const left = fileRow(shape, a);
  const right = fileRow(shape, b);
  return shape.columns
    .filter((c) => stableStringify(left[c.name]) !== stableStringify(right[c.name]))
    .map((c) => c.name);
}
