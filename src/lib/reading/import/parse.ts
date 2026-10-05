import { csvTable } from "./csv";
import { mapDurtal } from "./durtal";
import { detectFormat } from "./formats";
import { mapGoodreads } from "./goodreads";
import { mapStorygraph } from "./storygraph";
import type { ParsedFile } from "./types";

/*
 * A reading history file to rows (SLN-450): the header names the format, and
 * that format's mapper turns each data row into one `ImportRow`. Pure: no
 * database, so the mappers are tested with fixtures. Rows whose cells are all
 * empty are dropped; the rest keep their data row number (1 after the header).
 */
export function parseImportFile(text: string): ParsedFile & { rowNos: number[] } {
  const { headers, rows } = csvTable(text);
  const kept = rows.map((r, i) => ({ r, no: i + 1 })).filter(({ r }) => Object.values(r).some((v) => v.trim()));
  const records = kept.map((k) => k.r);
  const source = detectFormat(headers);
  const parsed =
    source === "durtal" ? mapDurtal(headers, records) : source === "goodreads" ? mapGoodreads(headers, records) : mapStorygraph(headers, records);
  return { ...parsed, rowNos: kept.map((k) => k.no) };
}
