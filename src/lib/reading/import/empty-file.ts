import { NATIVE_EXPORTS, NATIVE_EXPORTS_V2 } from "@/lib/export/schema";
import { csvTable, detectDelimiter } from "./csv";
import { GOODREADS_EXPORT_HEADER, ImportFileError, type importUploadFormat } from "./formats";
import { emptyDurtalExport } from "./parse";

type UploadFormat = NonNullable<ReturnType<typeof importUploadFormat>>;
interface EmptyImport { source: "durtal" | "goodreads" | "export"; entity: string; }
const NATIVE_MESSAGE = "This file has records. Import reading history as CSV or TSV; nothing was imported.";

/** Recognize a complete empty export before allocating an import or retaining its bytes. */
export async function emptyImportFile(bytes: Uint8Array, format: UploadFormat): Promise<EmptyImport | null> {
  if (format === "parquet") {
    // Kept server-side and loaded only for a Parquet file.
    const { ParquetReader } = await import("@dsnp/parquetjs");
    let reader: Awaited<ReturnType<typeof ParquetReader.openBuffer>>;
    try { reader = await ParquetReader.openBuffer(Buffer.from(bytes)); }
    catch { throw new ImportFileError("This Parquet file could not be read. Nothing was imported."); }
    try {
      const metadata = reader.getMetadata();
      const found = [...Object.entries(NATIVE_EXPORTS), ...Object.entries(NATIVE_EXPORTS_V2)].find(([, definition]) => definition.entity === metadata["durtal.entity"] && String(definition.version) === metadata["durtal.schema_version"]);
      if (!found) throw new ImportFileError("This is not a recognized Durtal Parquet export. Nothing was imported.");
      const [entity, definition] = found;
      const fields = Object.keys(reader.getSchema().fields).sort();
      if (JSON.stringify(fields) !== JSON.stringify(Object.keys(definition.fields).sort())) throw new ImportFileError("This Parquet export's columns are incomplete. Nothing was imported.");
      if (reader.getRowCount().toString() !== "0") throw new ImportFileError(NATIVE_MESSAGE);
      if (await reader.getCursor().next() !== null) throw new ImportFileError("This Parquet file has inconsistent row counts. Nothing was imported.");
      return { source: "durtal", entity };
    } catch (error) {
      if (error instanceof ImportFileError) throw error;
      throw new ImportFileError("This Parquet file could not be read. Nothing was imported.");
    } finally { await reader.close(); }
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ImportFileError("This file is not valid UTF-8 text. Export it as UTF-8 and try again."); }
  if (format === "json") {
    let data: unknown;
    try { data = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { throw new ImportFileError("This JSON file could not be read. Nothing was imported."); }
    if (!Array.isArray(data)) throw new ImportFileError("This is not a JSON export list. Nothing was imported.");
    if (data.length) throw new ImportFileError(NATIVE_MESSAGE);
    // [] carries no kind or provenance metadata, so do not invent either.
    return { source: "export", entity: "export" };
  }
  const entity = emptyDurtalExport(text);
  if (entity) return { source: "durtal", entity };
  const { headers, rows } = csvTable(text, detectDelimiter(text), false);
  if (GOODREADS_EXPORT_HEADER.every((column) => headers.includes(column)) && !rows.some((row) => Object.values(row).some((value) => value.trim()))) return { source: "goodreads", entity: "goodreads" };
  return null;
}
