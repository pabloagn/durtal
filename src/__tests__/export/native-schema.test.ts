import { describe, expect, it } from "vitest";
import { ParquetReader } from "@dsnp/parquetjs";
import { nativeJSON } from "@/lib/export/native";
import { NATIVE_EXPORTS, NATIVE_EXPORTS_V2, type ExportDefinition, type NativeField } from "@/lib/export/schema";
import { nativeParquet, parquetSchema, NATIVE_PARQUET_OPTIONS } from "@/lib/export/parquet";

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

function populated(field: NativeField): unknown {
  switch (field.kind) {
    case "text": return "0001; É Name";
    case "boolean": return true;
    case "instant": return "9007199254740993";
    case "date": return -1;
    case "int32":
    case "int64": return 4;
    case "double": return 4.25;
    case "list": return [populated(field.element)];
    case "struct":
      if ("precision" in field.fields && "approximate" in field.fields) {
        return { precision: "range", start: { year: -44, month: null, day: null }, end: { year: -43, month: 3, day: null }, approximate: true, label: "BCE; range" };
      }
      return Object.fromEntries(Object.entries(field.fields).map(([key, child]) => [key, populated(child)]));
  }
}
const fullRow = (definition: ExportDefinition) => Object.fromEntries(Object.entries(definition.fields).map(([key, field]) => [key, populated(field)]));

/** Expected physical scalar values, without calling the exporter conversion code. */
function expectedPhysical(field: NativeField, value: unknown): unknown {
  if (value === null) return null;
  if (field.kind === "instant") return BigInt(value as string);
  if (field.kind === "int64") return BigInt(value as number);
  if (field.kind === "list") return (value as unknown[]).map((item) => expectedPhysical(field.element, item));
  if (field.kind === "struct") return Object.fromEntries(Object.entries(field.fields).map(([key, child]) => [key, expectedPhysical(child, (value as Record<string, unknown>)[key])]));
  return value;
}

/** The package reader exposes the standard three-level LIST envelope. */
function unwrapPhysical(field: NativeField, value: unknown): unknown {
  if (value === null) return null;
  if (field.kind === "list") {
    const envelope = value as { list: { element: unknown }[] | null };
    expect(Object.hasOwn(envelope, "list")).toBe(true);
    return (envelope.list ?? []).map(({ element }) => unwrapPhysical(field.element, element));
  }
  if (field.kind === "struct") return Object.fromEntries(Object.entries(field.fields).map(([key, child]) => [key, unwrapPhysical(child, (value as Record<string, unknown>)[key])]));
  if (field.kind === "instant" || field.kind === "int64") expect(typeof value).toBe("bigint");
  return value;
}

// This package-reader regression check complements the independent Arrow
// acceptance oracle; it does not replace that cross-implementation proof.
async function readPhysical(buffer: Buffer, definition: ExportDefinition) {
  const reader = await ParquetReader.openBuffer(buffer);
  const fields = reader.getSchema().fieldList;
  const saved = fields.map((field) => ({ field, descriptor: Object.getOwnPropertyDescriptor(field, "originalType") }));
  try {
    // Snapshot the actual file schema before any reader-only adjustments.
    const schema = reader.metadata!.schema.map((field) => ({
      name: field.name, type: field.type ?? null, repetition: field.repetition_type ?? null,
      children: field.num_children ?? null, converted: field.converted_type ?? null,
    }));
    const logical = fields.map((field) => ({ path: field.path.join("."), primitive: field.primitiveType, logical: field.originalType }));
    expect(Object.keys(reader.getSchema().fields)).toEqual(Object.keys(definition.fields));
    // parquetjs converts logical dates through JS Date. Disable that only on
    // this reader's fields so exact signed physical integers reach assertions.
    // No exporter, prototype, global conversion table or dependency is patched.
    for (const field of fields) if (field.originalType === "TIMESTAMP_MICROS" || field.originalType === "DATE") delete field.originalType;
    const rows: Record<string, unknown>[] = [];
    const cursor = reader.getCursor();
    for (let value = await cursor.next(); value !== null; value = await cursor.next()) {
      const record = value as Record<string, unknown>;
      rows.push(Object.fromEntries(Object.entries(definition.fields).map(([key, field]) => [key, unwrapPhysical(field, record[key])])));
    }
    return { schema, logical, rows, count: reader.getRowCount().toString(), metadata: reader.getMetadata() };
  } finally {
    for (const { field, descriptor } of saved) {
      if (descriptor) Object.defineProperty(field, "originalType", descriptor);
      else delete field.originalType;
    }
    await reader.close();
  }
}

const expectedRows = (definition: ExportDefinition, rows: Record<string, unknown>[]) => rows.map((record) =>
  Object.fromEntries(Object.entries(definition.fields).map(([key, field]) => [key, expectedPhysical(field, record[key])])));

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
    expect(NATIVE_EXPORTS_V2.readings.legacyHeaders.at(-1)).toBe("pages_read");
    expect(NATIVE_EXPORTS.readings.version).toBe(3);
    expect(NATIVE_EXPORTS["reading-sessions"].version).toBe(3);
    expect(NATIVE_EXPORTS["reading-notes"].version).toBe(3);
    expect(NATIVE_EXPORTS.works.version).toBe(2);
    expect(NATIVE_PARQUET_OPTIONS).toEqual({ rowGroupSize: 2048, pageSize: 2048, useDataPageV2: false, pageIndex: true });
  });

  it.each([...Object.entries(NATIVE_EXPORTS), ...Object.entries(NATIVE_EXPORTS_V2).filter(([key]) => ["readings", "reading-sessions", "reading-notes"].includes(key))])("%s serializes one schema for empty/null-first/reversed rows and keys", async (_entity, definition) => {
    const first = row(definition), other = fullRow(definition);
    const key = definition.legacyHeaders.find((name) => definition.fields[name].kind === "text")!;
    other[key] = "0001; name";
    const reversedKeys = Object.fromEntries(Object.entries(other).reverse());
    const shapes = [[], [first], [other], [first, other], [reversedKeys, first]];
    const outputs = await Promise.all(shapes.map(async (rows) => {
      const before = structuredClone(rows);
      const output = await readPhysical(await nativeParquet(definition, rows), definition);
      expect(output.rows).toEqual(expectedRows(definition, rows));
      expect(output.count).toBe(String(rows.length));
      expect(output.metadata).toEqual({ "durtal.entity": definition.entity, "durtal.schema_version": String(definition.version) });
      expect(rows).toEqual(before);
      const json = JSON.parse(nativeJSON(definition, rows));
      expect(json).toHaveLength(rows.length);
      for (const value of json) expect(Object.keys(value)).toEqual(Object.keys(definition.fields));
      return output;
    }));
    for (const output of outputs) expect(output.schema).toEqual(outputs[0].schema);
    expect(Object.isFrozen(definition.fields)).toBe(true);
  });

  it("reads null, empty and populated nested lists from the serialized file", async () => {
    const definition = NATIVE_EXPORTS.works, book = row(definition);
    const rows = [book, { ...book, authors: [], acquisition_targets: [], edition_publishers: [] }, {
      ...book, authors: ["Writer; Translator", "", "\ue000", "\u{10000}"], acquisition_targets: [],
      edition_publishers: [
        { edition_id: "one", isbn_13: null, publishers: null },
        { edition_id: "two", isbn_13: "0000123", publishers: [] },
        { edition_id: "three", isbn_13: null, publishers: [{ id: "publisher", name: "A; B", kind: null, parent_id: null }] },
      ],
    }];
    const output = await readPhysical(await nativeParquet(definition, rows), definition);
    expect(output.rows).toEqual(expectedRows(definition, rows));
    expect(output.rows.map((value) => value.authors)).toEqual([null, [], ["Writer; Translator", "", "\ue000", "\u{10000}"]]);
    expect(output.rows[2].edition_publishers).toEqual(rows[2].edition_publishers);
  });

  it("keeps exact instants and per-file metadata across concurrent writers", async () => {
    const definition = NATIVE_EXPORTS["reading-sessions"];
    const negative = { ...row(definition), day: -1, started_at: "-1", ended_at: null };
    const beyondSafeInteger = { ...row(definition), day: 0, started_at: "9007199254740993", ended_at: "123456" };
    const person = fullRow(NATIVE_EXPORTS.authors);
    const buffers = await Promise.all([
      nativeParquet(definition, [negative]), nativeParquet(definition, [beyondSafeInteger]),
      nativeParquet(NATIVE_EXPORTS.authors, [person]), nativeParquet(definition, []),
    ]);
    const [a, b, c, empty] = await Promise.all([
      readPhysical(buffers[0], definition), readPhysical(buffers[1], definition),
      readPhysical(buffers[2], NATIVE_EXPORTS.authors), readPhysical(buffers[3], definition),
    ]);
    expect(a.rows[0]).toMatchObject({ day: -1, started_at: BigInt(-1), ended_at: null });
    expect(b.rows[0]).toMatchObject({ day: 0, started_at: BigInt("9007199254740993"), ended_at: BigInt(123456) });
    expect(a.logical).toContainEqual({ path: "started_at", primitive: "INT64", logical: "TIMESTAMP_MICROS" });
    expect(a.logical).toContainEqual({ path: "day", primitive: "INT32", logical: "DATE" });
    expect(a.schema).toEqual(b.schema);
    expect(empty.schema).toEqual(a.schema);
    expect(empty.rows).toEqual([]);
    expect(c.rows).toEqual(expectedRows(NATIVE_EXPORTS.authors, [person]));
    expect(c.metadata["durtal.entity"]).toBe("people");
    expect(a.metadata["durtal.entity"]).toBe("reading-sessions");
    expect(b.metadata).toEqual(a.metadata);
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
