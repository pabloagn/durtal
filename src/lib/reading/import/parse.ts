import { csvTable, detectDelimiter, restoreDurtalFormulaGuard } from "./csv";
import { mapDurtal } from "./durtal";
import { detectFormat, ImportFileError } from "./formats";
import { mapGoodreads } from "./goodreads";
import { mapStorygraph } from "./storygraph";
import type { ParsedFile } from "./types";

/*
 * A reading history file to rows (SLN-450): the header names the format, and
 * that format's mapper turns each data row into one `ImportRow`. Pure: no
 * database, so the mappers are tested with fixtures. Rows whose cells are all
 * empty are dropped; the rest keep their data row number (1 after the header).
 * An empty file is refused (SLN-955). A file with only its header parses to
 * no rows, as Durtal's own export of no readings does; an upload refuses it
 * (`parseUploadedFile`).
 */
export function parseImportFile(text: string): ParsedFile & { rowNos: number[] } {
  if (!text.replace(/^\uFEFF/, "").trim()) throw new ImportFileError("This file is empty");
  const { headers, rows } = csvTable(text, detectDelimiter(text), false);
  const kept = rows.map((r, i) => ({ r, no: i + 1 })).filter(({ r }) => Object.values(r).some((v) => v.trim()));
  const source = detectFormat(headers);
  // Goodreads/StoryGraph cells are authored data. Only known Durtal reading
  // files use Durtal's legacy spreadsheet escape (which has no provenance marker).
  const records = kept.map(({ r }) => source === "durtal"
    ? Object.fromEntries(Object.entries(r).map(([key, value]) => [key, restoreDurtalFormulaGuard(value)]))
    : r);
  const parsed =
    source === "durtal" ? mapDurtal(headers, records) : source === "goodreads" ? mapGoodreads(headers, records) : mapStorygraph(headers, records);
  return { ...parsed, rowNos: kept.map((k) => k.no) };
}

/** An uploaded file, refused when it has no rows: no import is kept for it (SLN-955) */
export function parseUploadedFile(text: string): ReturnType<typeof parseImportFile> {
  const parsed = parseImportFile(text);
  if (!parsed.rows.length) throw new ImportFileError("This file has no rows");
  return parsed;
}
