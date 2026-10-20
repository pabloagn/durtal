import { describe, expect, it } from "vitest";
import { DURTAL_EXPORT_HEADERS } from "@/lib/export/columns";
import { NATIVE_EXPORTS } from "@/lib/export/schema";
import { toCSV, toTSV } from "@/lib/utils/export";
import { csvTable, detectDelimiter, parseCsv, parseDelimited } from "@/lib/reading/import/csv";
import { detectDurtalExport, detectFormat, delimitedUploadFormat, ImportFileError, UnsupportedDurtalExportError } from "@/lib/reading/import/formats";
import { parseImportFile, parseUploadedFile } from "@/lib/reading/import/parse";

const workId = "35a7a48b-c29e-4b03-812a-96da79436a1f";
const readingId = "52670e95-468d-4b5f-a071-060bc52a95c8";
const reading = {
  reading_id: readingId, work_id: workId, title: "Émilie; \u{10000}", authors: "A Writer", status: "finished",
  format: "print", unit: "pages", started_precision: "unknown", finished_precision: "unknown", source_key: `durtal:${readingId}`,
  review_html: '<p>A tab\tand a comma, then a "quote".</p>\n<p>Second line</p>',
};

describe("quoted CSV and TSV", () => {
  it.each([",", "\t"] as const)("keeps delimiters and line breaks inside %j cells", (delimiter) => {
    const text = `\uFEFFfirst${delimiter}second\r\n"Émilie,\t\u{10000}"${delimiter}"say ""yes""\r\nnext"\r\n`;
    expect(parseDelimited(text, delimiter)).toEqual([["first", "second"], ["Émilie,\t\u{10000}", 'say "yes"\r\nnext']]);
    expect(detectDelimiter(text)).toBe(delimiter);
  });

  it("uses the header outside quotes, with leading empty lines", () => {
    expect(detectDelimiter('\uFEFF\n\r\n"Title, original"\tstatus\n')).toBe("\t");
    expect(detectDelimiter('"Title\talternate",status\n')).toBe(",");
    expect(detectDelimiter('"Title, with, commas"\t"status"\n')).toBe("\t");
    expect(detectDelimiter('"Title\twith\ttabs","status"\n')).toBe(",");
  });

  it("ignores many tab-only leading lines before a quoted CSV header", () => {
    const csv = toCSV([reading], DURTAL_EXPORT_HEADERS.readings);
    const header = DURTAL_EXPORT_HEADERS.readings.map((name) => `"${name}"`).join(",");
    const text = `\uFEFF${"\t\t\t\r\n".repeat(40)}${header}\n${csv.slice(csv.indexOf("\n") + 1)}`;
    expect(detectDelimiter(text)).toBe(",");
    expect(parseImportFile(text)).toEqual(parseImportFile(csv));
  });

  it("retains authored whitespace inside a quoted cell", () => {
    expect(parseDelimited('\t\n  \r\n" \t "\n', ",")).toEqual([[" \t "]]);
  });

  it("leaves authored apostrophes alone in raw cells and third-party imports", () => {
    expect(parseDelimited("a,b\n'=authored,'plain\n", ",")[1]).toEqual(["'=authored", "'plain"]);
    expect(parseImportFile("Title,Exclusive Shelf,My Rating\n'=authored,read,4\n").rows[0].title).toBe("'=authored");
    expect(parseImportFile("Title\tAuthors\tRead Status\tStar Rating\n'+authored\tA Writer\tread\t4\n").rows[0].title).toBe("'+authored");
    // The established helper contract is retained for its existing callers.
    expect(parseCsv("a,b\n'=guard,'plain\n")[1]).toEqual(["=guard", "'plain"]);
  });

  it.each([",", "\t"] as const)("refuses broken %j quoting and ambiguous headers", (delimiter) => {
    expect(() => parseDelimited(`a${delimiter}b\n"unfinished`, delimiter)).toThrow("unclosed quoted cell");
    expect(() => parseDelimited(`a${delimiter}b\n"closed"oops${delimiter}x`, delimiter)).toThrow("text after a closing quote");
    expect(() => csvTable(`a${delimiter}a\n1${delimiter}2`, delimiter)).toThrow("repeats a column name");
    expect(() => csvTable(`a${delimiter}\n1${delimiter}2`, delimiter)).toThrow("empty column name");
    expect(() => csvTable(`a${delimiter}b\n1${delimiter}2${delimiter}3`, delimiter)).toThrow("more cells than its header");
    expect(csvTable(`a${delimiter}b\n1`, delimiter).rows).toEqual([{ a: "1", b: "" }]);
  });
});

describe("Durtal table header recognition", () => {
  const names = { works: "books", authors: "people", films: "films", perfumes: "perfumes", paintings: "paintings", readings: "readings", "reading-sessions": "sessions", "reading-notes": "quotes and notes" } as const;

  it.each(Object.entries(DURTAL_EXPORT_HEADERS))("recognizes %s in both formats without changing export columns", (kind, headers) => {
    expect(headers).toEqual(NATIVE_EXPORTS[kind as keyof typeof NATIVE_EXPORTS].legacyHeaders);
    expect(detectDurtalExport([...headers])).toBe(kind);
    expect(detectDurtalExport(([...headers] as string[]).reverse().concat("future_column"))).toBe(kind);
    for (const write of [toCSV, toTSV]) {
      const text = write([{ ...reading, name: "Fixture person" }], [...headers]);
      if (["readings", "reading-sessions", "reading-notes"].includes(kind)) {
        expect(parseImportFile(text).source).toBe("durtal");
      } else {
        expect(() => parseImportFile(text)).toThrow(UnsupportedDurtalExportError);
        expect(() => parseImportFile(text)).toThrow(`This is Durtal's ${names[kind as keyof typeof names]} file.`);
        expect(() => parseImportFile(text)).not.toThrow("not a Goodreads, StoryGraph or Durtal export");
      }
    }
  });

  it("does not turn a partial reading file or unknown file into another entity", () => {
    expect(detectFormat(["work_id", "source_key"])).toBe("durtal");
    expect(detectDurtalExport(["name", "price"])).toBeNull();
    expect(() => detectFormat(["name", "price"])).toThrow("not a Goodreads, StoryGraph or Durtal export");
    expect(() => detectDurtalExport([...new Set([...DURTAL_EXPORT_HEADERS.works, ...DURTAL_EXPORT_HEADERS.authors])])).toThrow("combines different Durtal export headers");
  });

  it("names unavailable files truthfully without claiming a restore destination exists", () => {
    expect(() => detectFormat([...DURTAL_EXPORT_HEADERS.works])).toThrow("Only reading history imports here.");
    expect(detectFormat([...DURTAL_EXPORT_HEADERS["reading-sessions"]])).toBe("durtal");
    expect(detectFormat([...DURTAL_EXPORT_HEADERS["reading-notes"]])).toBe("durtal");
  });
});

describe("reading CSV/TSV compatibility", () => {
  it("parses the same quoted multiline Unicode reading from both exported formats", () => {
    expect(parseImportFile(toTSV([reading], DURTAL_EXPORT_HEADERS.readings))).toEqual(parseImportFile(toCSV([reading], DURTAL_EXPORT_HEADERS.readings)));
  });

  it("retains Durtal's existing formula-guard round trip without changing unrelated apostrophes", () => {
    for (const write of [toCSV, toTSV]) {
      expect(parseImportFile(write([{ ...reading, title: "=a formula-looking title" }], DURTAL_EXPORT_HEADERS.readings)).rows[0].title).toBe("=a formula-looking title");
      expect(parseImportFile(write([{ ...reading, title: "'authored title" }], DURTAL_EXPORT_HEADERS.readings)).rows[0].title).toBe("'authored title");
    }
  });

  it.each([toCSV, toTSV])("keeps empty/header-only refusal and counts logical data rows", (write) => {
    expect(() => parseUploadedFile("\uFEFF\n")).toThrow(ImportFileError);
    const empty = write([], DURTAL_EXPORT_HEADERS.readings);
    expect(parseImportFile(empty).rows).toEqual([]);
    expect(parseUploadedFile(empty)).toMatchObject({ emptyEntity: "readings", rows: [] });
    expect(parseImportFile(write([reading], DURTAL_EXPORT_HEADERS.readings)).rowNos).toEqual([1]);
  });
});

describe("upload file types", () => {
  it.each(["", "text/plain", "application/vnd.ms-excel", "application/octet-stream"])("accepts common %j MIME fallbacks", (type) => {
    expect(delimitedUploadFormat("readings.CSV", type)).toBe("csv");
    expect(delimitedUploadFormat("readings.TSV", type)).toBe("tsv");
  });
  it("accepts declared delimited MIME types and refuses other formats", () => {
    expect(delimitedUploadFormat("readings.tsv", "text/tab-separated-values; charset=utf-8")).toBe("tsv");
    expect(delimitedUploadFormat("readings.csv", "text/csv")).toBe("csv");
    expect(delimitedUploadFormat("book.xlsx", "application/vnd.ms-excel")).toBeNull();
    expect(delimitedUploadFormat("book.csv", "image/png")).toBeNull();
    expect(delimitedUploadFormat("notes.md", "text/markdown")).toBeNull();
  });
});
