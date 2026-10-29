import { catalogueDateSchema } from "@/lib/catalogue/dates";
import { dateISO, instantISO, instantMicros } from "./instants";
import { CATALOGUE_DATE, type ExportDefinition, type NativeField } from "./schema";

export function nativeValue(field: NativeField, value: unknown, path: string, format: "json" | "parquet"): unknown {
  const invalid = (): never => { throw new Error(`Invalid native export field: ${path}`); };
  if (value === undefined) return invalid();
  if (value === null) return field.nullable ? null : invalid();
  if (field === CATALOGUE_DATE) catalogueDateSchema.parse(value);
  switch (field.kind) {
    case "text": return typeof value === "string" ? value : invalid();
    case "boolean": return typeof value === "boolean" ? value : invalid();
    case "double": return typeof value === "number" && Number.isFinite(value) ? value : invalid();
    case "int32":
    case "date":
    case "int64": {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) return invalid();
      if ((field.kind === "int32" || field.kind === "date") && (value < -2147483648 || value > 2147483647)) return invalid();
      if (field.kind === "date" && format === "json") return dateISO(value);
      return field.kind === "int64" && format === "parquet" ? BigInt(value) : value;
    }
    case "instant": return format === "json" ? instantISO(value) : instantMicros(value);
    case "list": {
      if (!Array.isArray(value)) return invalid();
      const items = value.map((item, index) => nativeValue(field.element, item, `${path}[${index}]`, format));
      return format === "json" ? items : { list: items.map((element) => ({ element })) };
    }
    case "struct": {
      if (typeof value !== "object" || Array.isArray(value) || value instanceof Date) return invalid();
      return nativeRecord(field.fields, value as Record<string, unknown>, path, format);
    }
  }
}
function nativeRecord(fields: Readonly<Record<string, NativeField>>, row: Record<string, unknown>, path: string, format: "json" | "parquet") {
  for (const key of Object.keys(row)) if (!Object.hasOwn(fields, key)) throw new Error(`Undeclared native export field: ${path}.${key}`);
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, nativeValue(field, row[key], `${path}.${key}`, format)]));
}
export function nativeRecords(definition: ExportDefinition, rows: readonly Record<string, unknown>[], format: "json" | "parquet") {
  return rows.map((row) => nativeRecord(definition.fields, row, definition.entity, format));
}
export function nativeJSON(definition: ExportDefinition, rows: readonly Record<string, unknown>[]): string {
  return JSON.stringify(nativeRecords(definition, rows, "json"));
}
