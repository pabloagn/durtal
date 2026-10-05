/*
 * A small RFC 4180 reader for reading history files (SLN-450): quoted
 * fields, doubled quotes, commas and newlines inside quotes, CRLF or LF, a
 * UTF-8 byte order mark, a trailing empty line. A cell is never evaluated:
 * `="0140449132"` stays text. A cell that starts with `'` before `=`, `+`,
 * `-`, `@`, a tab or a carriage return loses that `'`: the formula guard
 * Durtal's exports add, so they import back unchanged.
 */

const GUARDED = /^'[=+\-@\t\r]/;

/** Every record of the text, each a list of cells; empty lines are dropped */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const endCell = () => {
    record.push(GUARDED.test(cell) ? cell.slice(1) : cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    // A blank line (one empty cell) is not a record
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell === "") {
      quoted = true;
      i++;
    } else if (c === ",") {
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
  if (cell !== "" || record.length) endRecord();
  return records;
}

/** The header and the data rows as objects by header name; a short row's missing cells are "" */
export function csvTable(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [head, ...body] = parseCsv(text);
  const headers = (head ?? []).map((h) => h.trim());
  const rows = body.map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""])));
  return { headers, rows };
}
