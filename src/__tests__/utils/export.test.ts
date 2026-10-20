import { describe, expect, it } from "vitest";
import { toCSV, toTSV } from "@/lib/utils/export";
import { FORMAT_MIME, exportFormatsFor } from "@/lib/export/formats";
import { exportedMessage, exportFormatName, EXPORT_FORMAT_LABELS } from "@/components/shared/export-menu";
import { parseCsv, parseDelimited, restoreDurtalFormulaGuard } from "@/lib/reading/import/csv";
import { DURTAL_READING_COLUMNS } from "@/lib/reading/import/durtal-format";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { READING_EXPORT_COLUMNS, READING_READ_ONLY_COLUMNS } from "@/lib/export/reading";

/* Every export's CSV and TSV (SLN-458): headers for empty files, the formula guard, carriage returns, the byte order mark */

const BOM = "﻿";

describe("toCSV and toTSV", () => {
  it("write only the header for zero rows when given one, and nothing without", () => {
    expect(toCSV([], ["a", "b"])).toBe(`${BOM}a,b`);
    expect(toTSV([], ["a", "b"])).toBe(`${BOM}a\tb`);
    expect(toCSV([])).toBe("");
    expect(toTSV([])).toBe("");
  });

  it("follow the header list's columns and order, not the rows' keys", () => {
    expect(toCSV([{ b: 2, a: 1, extra: "x" }], ["a", "b"])).toBe(`${BOM}a,b\n1,2`);
    // A generic legacy helper may still take explicit object key order
    expect(toCSV([{ title: "Watt", rating: 4.5 }])).toBe(`${BOM}title,rating\nWatt,4.5`);
  });

  it("guard a text cell a spreadsheet would read as a formula, and never change a number", () => {
    const rows = [{ t: "=HYPERLINK(\"x\")" }, { t: "+1" }, { t: "-x" }, { t: "@SUM" }, { t: "\tlead" }, { t: "\rlead" }, { t: -2 }, { t: 4.5 }, { t: "a=b" }];
    const csv = toCSV(rows, ["t"]);
    expect(csv.split("\n").slice(1)).toEqual(['"\'=HYPERLINK(""x"")"', "'+1", "'-x", "'@SUM", "'\tlead", '"\'\rlead"', "-2", "4.5", "a=b"]);
    const tsv = toTSV(rows, ["t"]);
    expect(tsv.startsWith(BOM)).toBe(true);
    expect(parseDelimited(tsv, "\t").slice(1).map(([cell]) => restoreDurtalFormulaGuard(cell))).toEqual(rows.map(({ t }) => String(t)));
  });

  it("leave a file for another app to import as stored: no guard, no byte order mark", () => {
    expect(toCSV([{ t: "-Ramble" }, { t: "=x" }, { t: 3 }], ["t"], { forImport: true })).toBe("t\n-Ramble\n=x\n3");
    expect(toCSV([], ["t"], { forImport: true })).toBe("t");
  });

  it("quote a value with a carriage return, a comma, a quote or a newline", () => {
    expect(toCSV([{ t: "a\rb" }, { t: "a,b" }, { t: 'a"b' }, { t: "a\nb" }], ["t"]).split("\n").slice(1, 4)).toEqual(['"a\rb"', '"a,b"', '"a""b"']);
  });

  it("reads back through the reading importer's parser as the original text", () => {
    const values = ["=1+2", "+44", "-note", "@home", "\tindented", "plain, with a comma", 'say "hi"', "two\nlines", "Ñandú"];
    const csv = toCSV(values.map((v) => ({ v })), ["v"]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(parseCsv(csv).slice(1).map(([cell]) => cell)).toEqual(values);
  });

  it("round-trips TSV tabs, CR, LF, quotes, leading quote characters and empty cells", () => {
    const values = ["one\tcell", "two\nlines", "two\r\nlines", "two\rlines", 'say "hi"', '"starts with a quote', "", "Émilie \u{10000}", "\tindented"];
    const rows = values.map((value, id) => ({ id, value }));
    const tsv = toTSV(rows, ["id", "value"]);
    expect(tsv.startsWith(`${BOM}id\tvalue\n`)).toBe(true);
    expect(parseDelimited(tsv, "\t").slice(1).map(([id, value]) => [id, restoreDurtalFormulaGuard(value)]))
      .toEqual(values.map((value, id) => [String(id), value]));
    expect(tsv).toContain('"say ""hi"""');
  });
});

describe("legacy nested spreadsheet cells", () => {
  it("keeps nested object key order, boolean words and Date milliseconds", () => {
    const row = { target: { id: "0001", createdAt: new Date("2026-10-16T10:20:30.123Z") }, favourite: false, missing: null };
    expect(toCSV([row])).toBe('﻿target,favourite,missing\n"{""id"":""0001"",""createdAt"":""2026-10-16T10:20:30.123Z""}",no,');
    expect(toTSV([row])).toBe('﻿target\tfavourite\tmissing\n"{""id"":""0001"",""createdAt"":""2026-10-16T10:20:30.123Z""}"\tno\t');
  });
});

describe("one export shape for every kind (SLN-894)", () => {
  it("offers CSV, TSV, Parquet and JSON for every kind; Markdown for the commonplace book; CSV for Goodreads", () => {
    for (const entity of ["works", "authors", "perfumes", "films", "paintings", "readings", "reading-sessions"])
      expect(exportFormatsFor(entity), entity).toEqual(["csv", "tsv", "parquet", "json"]);
    expect(exportFormatsFor("reading-notes")).toEqual(["csv", "tsv", "parquet", "json", "md"]);
    expect(exportFormatsFor("goodreads")).toEqual(["csv"]);
  });

  it("sends every text file as UTF-8", () => {
    for (const mime of Object.values(FORMAT_MIME).filter((m) => m.startsWith("text/") || m.includes("json"))) expect(mime).toMatch(/; charset=utf-8$/);
  });

  it("says books and people, in the right number, with the menu's format name", () => {
    expect(exportedMessage("works", ["a"], "csv")).toBe("Exported 1 book as CSV");
    expect(exportedMessage("works", Array.from({ length: 1200 }, (_, i) => String(i)), "parquet")).toBe("Exported 1,200 books as Parquet");
    expect(exportedMessage("authors", ["a", "b"], "json")).toBe("Exported 2 people as JSON");
    expect(exportedMessage("authors", ["a"], "tsv")).toBe("Exported 1 person as TSV");
    expect(exportedMessage("readings", { filters: "status=finished" }, "csv")).toBe("Exported readings as CSV");
    expect(exportedMessage("reading-notes", { filters: "" }, "md")).toBe("Exported quotes and notes as Markdown");
    expect(exportFormatName("parquet")).toBe("Parquet");
    expect(EXPORT_FORMAT_LABELS.md).toBe("Markdown (export only)");
    expect(exportFormatName("md")).toBe("Markdown");
  });
});

describe("the reading exports' headers", () => {
  it("write the Durtal reading CSV first, then the read-only columns", () => {
    expect(READING_EXPORT_COLUMNS.slice(0, DURTAL_READING_COLUMNS.length)).toEqual([...DURTAL_READING_COLUMNS]);
    expect(READING_EXPORT_COLUMNS.slice(DURTAL_READING_COLUMNS.length, DURTAL_READING_COLUMNS.length + READING_READ_ONLY_COLUMNS.length)).toEqual([...READING_READ_ONLY_COLUMNS]);
    expect(READING_EXPORT_COLUMNS.slice(DURTAL_READING_COLUMNS.length + READING_READ_ONLY_COLUMNS.length)).toEqual(["export_version", "start_percent", "start_minutes", "source", "location_id", "last_read_at", "created_at", "updated_at"]);
    expect(DURTAL_READING_COLUMNS.at(-1)).toBe("source_key");
  });

  it("use Goodreads' own header, starting with Book Id", () => {
    expect(GOODREADS_EXPORT_HEADER[0]).toBe("Book Id");
    expect(GOODREADS_EXPORT_HEADER).toHaveLength(24);
  });
});
