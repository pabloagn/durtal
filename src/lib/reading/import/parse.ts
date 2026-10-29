import { csvTable, detectDelimiter, restoreDurtalFormulaGuard } from "./csv";
import { invalidUnicode, safeRawCell } from "./fields";
import { mapDurtal } from "./durtal";
import { detectDurtalExport, detectFormat, ImportFileError } from "./formats";
import { mapGoodreads } from "./goodreads";
import { mapStorygraph } from "./storygraph";
import { mapHistory } from "./history-parse";
import type { ParsedFile } from "./types";

/*
 * A reading history file to rows (SLN-450): the header names the format, and
 * that format's mapper turns each data row into one `ImportRow`. Pure: no
 * database, so the mappers are tested with fixtures. Rows whose cells are all
 * empty are dropped; the rest keep their data row number (1 after the header).
 * An empty file is refused (SLN-955). A file with only its header parses to
 * no rows. Known Durtal headers are an explicit successful no-op; other
 * header-only uploads are refused (`parseUploadedFile`).
 */
export function parseImportFile(text: string): ParsedFile & { rowNos: number[]; emptyEntity?: import("./formats").DurtalExportKind } {
  if (!text.replace(/^\uFEFF/, "").trim()) throw new ImportFileError("This file is empty");
  const { headers, rows } = csvTable(text, detectDelimiter(text), false);
  if (headers.some(invalidUnicode)) throw new ImportFileError("A column name contains a character PostgreSQL cannot store");
  const kept = rows.map((r, i) => ({ r, no: i + 1 })).filter(({ r }) => Object.values(r).some((v) => v.trim()));
  const kind = detectDurtalExport(headers);
  if (!kept.length && kind) return { source: "durtal" as const, rows: [], rowNos: [], missing: [], emptyEntity: kind };
  const source = kind === "reading-sessions" || kind === "reading-notes" ? "durtal" : detectFormat(headers);
  // Goodreads/StoryGraph cells are authored data. Only known Durtal reading
  // files use Durtal's legacy spreadsheet escape (which has no provenance marker).
  const invalid = kept.map(({r}) => source === "durtal" && Object.values(r).some(invalidUnicode));
  const records = kept.map(({ r }) => source === "durtal"
    ? Object.fromEntries(Object.entries(r).map(([key, value]) => [key, r.export_version === "3" && value.startsWith("''") ? value.slice(1) : restoreDurtalFormulaGuard(value)]))
    : r);
  const safeRecords = records.map((r,i) => invalid[i] ? Object.fromEntries(Object.entries(r).map(([key,value]) => [key,safeRawCell(value)])) : r);
  const parsed =
    kind === "reading-sessions" ? mapHistory("sessions", safeRecords) : kind === "reading-notes" ? mapHistory("notes", safeRecords) : source === "durtal" ? mapDurtal(headers, safeRecords) : source === "goodreads" ? mapGoodreads(headers, records) : mapStorygraph(headers, records);
  parsed.rows.forEach((row,i) => { if (invalid[i]) row.error = "A cell contains a character PostgreSQL cannot store"; });
  return { ...parsed, rowNos: kept.map((k) => k.no) };
}

/** Header-only Durtal files succeed without keeping an import; other empty uploads are refused. */
export function parseUploadedFile(text: string): ReturnType<typeof parseImportFile> {
  const parsed = parseImportFile(text);
  if (!parsed.rows.length && !parsed.emptyEntity) throw new ImportFileError("This file has no rows");
  return parsed;
}

/** Header-only Durtal files succeed before allocating an import or calling a provider. */
export function emptyDurtalExport(text: string) {
  if (!text.replace(/^\uFEFF/, "").trim()) throw new ImportFileError("This file is empty");
  const { headers, rows } = csvTable(text, detectDelimiter(text), false);
  if (headers.some(invalidUnicode)) throw new ImportFileError("A column name contains a character PostgreSQL cannot store");
  const kind = detectDurtalExport(headers);
  return kind && !rows.some((row) => Object.values(row).some((value) => value.trim())) ? kind : null;
}
