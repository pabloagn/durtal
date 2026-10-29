import { ImportFileError } from "./formats";

/*
 * A small RFC 4180 reader for reading history files (SLN-450): quoted
 * fields, doubled quotes, commas and newlines inside quotes, CRLF or LF, a
 * UTF-8 byte order mark, a trailing empty line. A cell is never evaluated:
 * `="0140449132"` stays text. A cell that starts with `'` before `=`, `+`,
 * `-`, `@`, a tab or a carriage return loses exactly one `'`: the formula
 * guard Durtal's exports add before any literal leading quotes too.
 */

const GUARDED = /^'+[=+\-@\t\r]/;

export type Delimiter = "," | "\t";

/** Delimiters inside a quoted header cell are text, not a format hint. */
export function detectDelimiter(text: string): Delimiter {
  let quoted = false, started = false, commas = 0, tabs = 0;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      started = true;
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (c === "\r" || c === "\n") {
        if (started) break;
        commas = 0;
        tabs = 0;
        continue;
      }
      if (c.trim()) started = true;
      if (c === ",") commas++;
      if (c === "\t") tabs++;
    }
  }
  return tabs > commas ? "\t" : ",";
}

/** Legacy Durtal exports have no marker distinguishing this escape from authored text. */
export const restoreDurtalFormulaGuard = (cell: string) => GUARDED.test(cell) ? cell.slice(1) : cell;

/** Every record of the text, each a list of cells; empty lines are dropped */
export function parseCsv(text: string): string[][] {
  // Preserve the established helper contract; format-aware imports opt in only for Durtal.
  return parseDelimited(text, ",").map((record) => record.map(restoreDurtalFormulaGuard));
}

/** Raw CSV/TSV cells. No spreadsheet escape or authored apostrophe is removed. */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let meaningful = false;
  let i = 0;
  const endCell = () => {
    record.push(cell);
    cell = "";
    closedQuote = false;
  };
  const endRecord = () => {
    endCell();
    // Ignore unquoted whitespace-only lines, but retain quoted whitespace and
    // comma-separated empty data records for the existing row-number rules.
    if (meaningful && !(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
    meaningful = false;
  };
  while (i < s.length) {
    const c = s[i];
    if (c.trim()) meaningful = true;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        closedQuote = true;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (closedQuote && c !== delimiter && c !== "\r" && c !== "\n") {
      if (c === " " || (c === "\t" && delimiter !== "\t")) { i++; continue; }
      throw new ImportFileError(`Row ${records.length + 1} has text after a closing quote`);
    }
    if (c === '"' && cell === "") {
      quoted = true;
      i++;
    } else if (c === delimiter) {
      endCell();
      i++;
    } else if (c === "\r") {
      endRecord();
      i += s[i + 1] === "\n" ? 2 : 1;
    } else if (c === "\n") {
      endRecord();
      i++;
    } else {
      cell += c;
      i++;
    }
  }
  if (quoted) throw new ImportFileError(`Row ${records.length + 1} has an unclosed quoted cell`);
  if (cell !== "" || record.length) endRecord();
  return records;
}

/** The header and the data rows as objects by header name; a short row's missing cells are "" */
export function csvTable(text: string, delimiter: Delimiter = ",", restoreGuard = true): { headers: string[]; rows: Record<string, string>[] } {
  const cells = parseDelimited(text, delimiter);
  const [head, ...body] = restoreGuard ? cells.map((record) => record.map(restoreDurtalFormulaGuard)) : cells;
  const headers = (head ?? []).map((h) => h.trim());
  if (headers.some((header) => !header)) throw new ImportFileError("This file has an empty column name");
  if (new Set(headers).size !== headers.length) throw new ImportFileError("This file repeats a column name");
  for (const [i, row] of body.entries()) if (row.length > headers.length) throw new ImportFileError(`Row ${i + 1} has more cells than its header`);
  const rows = body.map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""])));
  return { headers, rows };
}
