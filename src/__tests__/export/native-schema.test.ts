import { describe, expect, it } from "vitest";
import { nativeJSON, nativeRecords } from "@/lib/export/native";
import { NATIVE_EXPORTS, type ExportDefinition, type NativeField } from "@/lib/export/schema";
import { parquetSchema, NATIVE_PARQUET_OPTIONS } from "@/lib/export/parquet";

function sample(field: NativeField): unknown {
  if (field.nullable) return null;
  if (field.kind === "text") return "";
  if (field.kind === "boolean") return false;
  if (field.kind === "instant") return "0";
  if (field.kind === "list") return [];
  if (field.kind === "struct") return Object.fromEntries(Object.entries(field.fields).map(([key, child]) => [key, sample(child)]));
  return 0;
}
const row = (definition: ExportDefinition) => Object.fromEntries(Object.entries(definition.fields).map(([key, field]) => [key, sample(field)]));

describe("eight fixed native contracts", () => {
  it("fixes legacy headers and important types, independently of data", () => {
    expect(Object.keys(NATIVE_EXPORTS)).toEqual(["works", "authors", "films", "perfumes", "paintings", "readings", "reading-sessions", "reading-notes"]);
    expect(NATIVE_EXPORTS.works.fields.acquisition_priority.kind).toBe("text");
    expect(NATIVE_EXPORTS.works.fields.isbn_13.kind).toBe("text");
    expect(NATIVE_EXPORTS.works.fields.rating.kind).toBe("double");
    expect(NATIVE_EXPORTS.paintings.fields.height_cm.kind).toBe("double");
    expect(NATIVE_EXPORTS["reading-sessions"].fields.started_at.kind).toBe("instant");
    expect(NATIVE_EXPORTS["reading-notes"].fields.favourite.kind).toBe("boolean");
    expect(NATIVE_EXPORTS.authors.legacyHeaders).toHaveLength(17);
    expect(NATIVE_EXPORTS.readings.legacyHeaders.at(-1)).toBe("pages_read");
    expect(NATIVE_PARQUET_OPTIONS).toEqual({ rowGroupSize: 2048, pageSize: 2048, useDataPageV2: false, pageIndex: true });
  });

  it.each(Object.entries(NATIVE_EXPORTS))("%s keeps one schema for empty/null-first/reversed rows and keys", (_entity, definition) => {
    const first = row(definition), other = { ...first };
    const key = definition.legacyHeaders.find((name) => definition.fields[name].kind === "text")!;
    other[key] = "0001; name";
    const reversedKeys = Object.fromEntries(Object.entries(other).reverse());
    const shapes = [[], [first], [other], [first, other], [reversedKeys, first]];
    const expectedSchema = JSON.stringify(parquetSchema(definition).schema.schema);
    for (const rows of shapes) {
      expect(JSON.stringify(parquetSchema(definition).schema.schema)).toBe(expectedSchema);
      const json = JSON.parse(nativeJSON(definition, rows));
      expect(json).toHaveLength(rows.length);
      for (const value of json) expect(Object.keys(value)).toEqual(Object.keys(definition.fields));
      expect(nativeRecords(definition, rows, "parquet")).toHaveLength(rows.length);
    }
    expect(Object.isFrozen(definition.fields)).toBe(true);
  });

  it("distinguishes null, empty and literal-semicolon lists and rejects undeclared data", () => {
    const definition = NATIVE_EXPORTS.authors, person = row(definition);
    const rows = [null, [], ["Writer; Translator"]].map((roles) => ({ ...person, roles }));
    expect(JSON.parse(nativeJSON(definition, rows)).map((r: { roles: unknown }) => r.roles)).toEqual([null, [], ["Writer; Translator"]]);
    expect(() => nativeJSON(definition, [{ ...person, roles: [null] }])).toThrow();
    expect(() => nativeJSON(definition, [{ ...person, hiddenStorageKey: "secret" }])).toThrow(/Undeclared/);
    expect(() => nativeJSON(definition, [{ ...person, works_count: Number.MAX_SAFE_INTEGER + 1 }])).toThrow();
  });

  it("keeps empty text, false and zero; refuses nonfinite and wrong numeric types", () => {
    const definition = NATIVE_EXPORTS.works, book = { ...row(definition), title: "", rating: 0, is_anthology: false, isbn_13: "0000123" };
    expect(JSON.parse(nativeJSON(definition, [book]))[0]).toMatchObject({ title: "", rating: 0, is_anthology: false, isbn_13: "0000123" });
    for (const rating of [NaN, Infinity, "4"]) expect(() => nativeJSON(definition, [{ ...book, rating }])).toThrow();
    expect(() => nativeJSON(definition, [{ ...book, original_year: 2147483648 }])).toThrow();
  });

  it("uses raw signed timestamps and genuine nested columns without logical JSON", () => {
    const definition = NATIVE_EXPORTS["reading-sessions"], session = { ...row(definition), started_at: "-1", ended_at: "123456" };
    expect(JSON.parse(nativeJSON(definition, [session]))[0]).toMatchObject({ started_at: "1969-12-31T23:59:59.999999Z", ended_at: "1970-01-01T00:00:00.123456Z" });
    const schema = parquetSchema(NATIVE_EXPORTS.works).schema;
    expect(schema.findField(["acquisition_targets", "list", "element", "createdAt"]).primitiveType).toBe("INT64");
    expect(schema.findField(["edition_publishers", "list", "element", "publishers", "list", "element", "name"]).statistics).toBe(false);
    expect(schema.fieldList.some((f) => f.originalType === "JSON")).toBe(false);
  });
});
