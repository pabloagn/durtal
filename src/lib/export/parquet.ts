import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import { Writable } from "node:stream";
import { nativeRecords } from "./native";
import type { ExportDefinition, NativeField } from "./schema";

type Annotation = { path: string[]; type: "DATE" | "TIMESTAMP_MICROS" };
type SchemaFields = ConstructorParameters<typeof ParquetSchema>[0];

/** V1, one page per bounded row group. Numeric indexes remain enabled. */
export const NATIVE_PARQUET_OPTIONS = Object.freeze({ rowGroupSize: 2048, pageSize: 2048, useDataPageV2: false, pageIndex: true });

export function parquetSchema(definition: ExportDefinition) {
  const annotations: Annotation[] = [];
  function field(value: NativeField, path: string[]): Record<string, unknown> {
    if (value.kind === "struct") return { optional: value.nullable, fields: fields(value.fields, path) };
    if (value.kind === "list") return { type: "LIST", optional: value.nullable, fields: {
      list: { repeated: true, fields: { element: field(value.element, [...path, "list", "element"]) } },
    } };
    const type = { text: "UTF8", int32: "INT32", int64: "INT64", double: "DOUBLE", boolean: "BOOLEAN", date: "INT32", instant: "INT64" }[value.kind];
    if (value.kind === "date" || value.kind === "instant") annotations.push({ path, type: value.kind === "date" ? "DATE" : "TIMESTAMP_MICROS" });
    // parquetjs 1.8.7's JS string extrema are not UTF8 byte-order extrema.
    return { type, optional: value.nullable, encoding: "PLAIN", compression: "UNCOMPRESSED", statistics: value.kind !== "text" };
  }
  function fields(values: Readonly<Record<string, NativeField>>, parent: string[]) {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, field(value, [...parent, key])]));
  }
  return { schema: new ParquetSchema(fields(definition.fields, []) as SchemaFields), annotations };
}

/** Only this writer's footer sees logical date annotations; data remains signed physical integers. */
export function installFooterAnnotations(writer: ParquetWriter, annotations: readonly Annotation[]) {
  const envelope = writer.envelopeWriter;
  if (!envelope) throw new Error("Missing Parquet envelope");
  const descriptor = Object.getOwnPropertyDescriptor(envelope, "writeFooter");
  const original = envelope.writeFooter;
  const fields = annotations.map(({ path, type }) => ({ field: writer.schema.findField(path), type }));
  const saved = fields.map(({ field }) => Object.getOwnPropertyDescriptor(field, "originalType"));
  for (const { field, type } of fields) {
    if (!field || field.originalType !== undefined || field.primitiveType !== (type === "DATE" ? "INT32" : "INT64")) throw new Error("Invalid physical Parquet date field");
  }
  function restore() {
    fields.forEach(({ field }, index) => { const d = saved[index]; if (d) Object.defineProperty(field, "originalType", d); else delete field.originalType; });
    if (descriptor) Object.defineProperty(envelope!, "writeFooter", descriptor); else delete (envelope as unknown as Record<string, unknown>).writeFooter;
  }
  Object.defineProperty(envelope, "writeFooter", { configurable: true, writable: true, value: async function(metadata: Record<string, string>) {
    if (this !== envelope || !writer.closed || writer.rowBuffer.rowCount) throw new Error("Parquet footer reached before pages were flushed");
    try {
      for (const { field, type } of fields) { if (field.originalType !== undefined) throw new Error("Parquet annotation leaked into data encoding"); field.originalType = type; }
      await original.call(envelope, metadata);
    } finally { restore(); }
  } });
  return restore;
}

export async function nativeParquet(definition: ExportDefinition, rows: readonly Record<string, unknown>[]): Promise<Buffer> {
  const records = nativeRecords(definition, rows, "parquet");
  const { schema, annotations } = parquetSchema(definition);
  const chunks: Buffer[] = [];
  const sink = new Writable({ write(chunk: Buffer, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  // parquetjs types end() as fs.WriteStream, though its runtime only uses Writable callbacks.
  // Keep the standard Writable proved by the pinned adapter; contain the vendor mismatch here.
  const writer = await ParquetWriter.openStream(schema, sink as unknown as Parameters<typeof ParquetWriter.openStream>[1], { ...NATIVE_PARQUET_OPTIONS });
  const restore = installFooterAnnotations(writer, annotations);
  let completed = false;
  try {
    writer.setMetadata("durtal.entity", definition.entity);
    writer.setMetadata("durtal.schema_version", String(definition.version));
    for (const row of records) await writer.appendRow(row);
    await writer.close();
    completed = true;
    return Buffer.concat(chunks);
  } finally {
    restore();
    if (!completed) sink.destroy();
  }
}
