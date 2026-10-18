import { describe, expect, it } from "vitest";
import { ParquetReader } from "@dsnp/parquetjs";
import { toCSV, toJSON, toParquet, toTSV, typedRow } from "@/lib/utils/export";
import { FORMAT_MIME, exportFormatsFor } from "@/lib/export/formats";
import { exportedMessage, exportFormatName } from "@/components/shared/export-menu";
import { parseCsv } from "@/lib/reading/import/csv";
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
    // The works export still takes the first row's keys
    expect(toCSV([{ title: "Watt", rating: 4.5 }])).toBe(`${BOM}title,rating\nWatt,4.5`);
  });

  it("guard a text cell a spreadsheet would read as a formula, and never change a number", () => {
    const rows = [{ t: "=HYPERLINK(\"x\")" }, { t: "+1" }, { t: "-x" }, { t: "@SUM" }, { t: "\tlead" }, { t: "\rlead" }, { t: -2 }, { t: 4.5 }, { t: "a=b" }];
    const csv = toCSV(rows, ["t"]);
    expect(csv.split("\n").slice(1)).toEqual(['"\'=HYPERLINK(""x"")"', "'+1", "'-x", "'@SUM", "'\tlead", '"\'\rlead"', "-2", "4.5", "a=b"]);
    const tsv = toTSV(rows, ["t"]);
    expect(tsv.startsWith(BOM)).toBe(true);
    // TSV turns tabs and line breaks into spaces after the guard
    expect(tsv.split("\n").slice(1)).toEqual(["'=HYPERLINK(\"x\")", "'+1", "'-x", "'@SUM", "' lead", "' lead", "-2", "4.5", "a=b"]);
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
});

describe("typed rows for JSON and Parquet (SLN-894)", () => {
  const row = {
    title: "À rebours",
    original_year: 1884,
    publication_year: "",
    rating: 4,
    is_anthology: false,
    started_on: "2026-01-02",
    created_at: "2026-10-16T10:20:30.123456+00:00",
    edition_publishers: [{ edition_id: "e", publishers: [] }],
    notes: null,
  };

  it("write a missing value as null and keep numbers, booleans and nested data as they are", () => {
    expect(typedRow(row)).toEqual({ ...row, publication_year: null });
    expect(JSON.parse(toJSON([row], ["title", "publication_year", "missing"]))).toEqual([{ title: "À rebours", publication_year: null, missing: null }]);
  });

  it("read the same in a spreadsheet as before: yes or no, nested data as JSON text, nothing for null", () => {
    const csv = toCSV([row]).split("\n")[1];
    expect(csv).toBe('À rebours,1884,,4,no,2026-01-02,2026-10-16T10:20:30.123456+00:00,"[{""edition_id"":""e"",""publishers"":[]}]",');
  });

  it("type each Parquet column from its values, and write an empty file with its columns", async () => {
    const buf = await toParquet([row, { ...row, original_year: "", rating: 4.5, is_anthology: true, started_on: null, created_at: null, edition_publishers: [], notes: "Des Esseintes" }]);
    const reader = await ParquetReader.openBuffer(buf);
    const types = Object.fromEntries(Object.entries(reader.schema.fields).map(([name, f]) => [name, f.originalType ?? f.primitiveType]));
    expect(types).toEqual({
      title: "UTF8",
      original_year: "INT64",
      publication_year: "UTF8",
      // A rating is a number with halves even when a file's ratings are whole
      rating: "DOUBLE",
      is_anthology: "BOOLEAN",
      started_on: "DATE",
      created_at: "TIMESTAMP_MILLIS",
      edition_publishers: "JSON",
      notes: "UTF8",
    });
    const cursor = reader.getCursor();
    const first = (await cursor.next()) as Record<string, unknown>;
    const second = (await cursor.next()) as Record<string, unknown>;
    expect(first).toMatchObject({ original_year: 1884n, publication_year: null, rating: 4, is_anthology: false, notes: null });
    expect((first.started_on as Date).toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect((first.created_at as Date).toISOString()).toBe("2026-10-16T10:20:30.123Z");
    expect(first.edition_publishers).toEqual(row.edition_publishers);
    expect(second).toMatchObject({ original_year: null, rating: 4.5, is_anthology: true, started_on: null, edition_publishers: [], notes: "Des Esseintes" });

    const empty = await ParquetReader.openBuffer(await toParquet([], ["a", "b"]));
    expect(Object.keys(empty.schema.fields)).toEqual(["a", "b"]);
    expect(Number(empty.getRowCount())).toBe(0);
  });

  it("write a column of mixed kinds as text", async () => {
    const reader = await ParquetReader.openBuffer(await toParquet([{ v: 3 }, { v: "three" }]));
    expect(reader.schema.fields.v.originalType).toBe("UTF8");
    const cursor = reader.getCursor();
    expect([(await cursor.next())?.v, (await cursor.next())?.v]).toEqual(["3", "three"]);
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
  });
});

describe("the reading exports' headers", () => {
  it("write the Durtal reading CSV first, then the read-only columns", () => {
    expect(READING_EXPORT_COLUMNS.slice(0, DURTAL_READING_COLUMNS.length)).toEqual([...DURTAL_READING_COLUMNS]);
    expect(READING_EXPORT_COLUMNS.slice(DURTAL_READING_COLUMNS.length)).toEqual([...READING_READ_ONLY_COLUMNS]);
    expect(DURTAL_READING_COLUMNS.at(-1)).toBe("source_key");
  });

  it("use Goodreads' own header, starting with Book Id", () => {
    expect(GOODREADS_EXPORT_HEADER[0]).toBe("Book Id");
    expect(GOODREADS_EXPORT_HEADER).toHaveLength(24);
  });
});
