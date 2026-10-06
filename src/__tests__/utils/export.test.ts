import { describe, expect, it } from "vitest";
import { toCSV, toTSV } from "@/lib/utils/export";
import { parseCsv } from "@/lib/reading/import/csv";
import { DURTAL_READING_COLUMNS } from "@/lib/reading/import/durtal-format";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { READING_EXPORT_COLUMNS, READING_READ_ONLY_COLUMNS } from "@/lib/export/reading";

/* Every export's CSV and TSV (SLN-458): headers for empty files, the formula guard, carriage returns, the byte order mark */

const BOM = "﻿";

describe("toCSV and toTSV", () => {
  it("write only the header for zero rows when given one, and nothing without", () => {
    expect(toCSV([], ["a", "b"])).toBe(`${BOM}a,b`);
    expect(toTSV([], ["a", "b"])).toBe("a\tb");
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
    // TSV turns tabs and line breaks into spaces after the guard
    expect(tsv.split("\n").slice(1)).toEqual(["'=HYPERLINK(\"x\")", "'+1", "'-x", "'@SUM", "' lead", "' lead", "-2", "4.5", "a=b"]);
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
