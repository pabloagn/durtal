import { describe, expect, it } from "vitest";
import { GOODREADS_EXPORT_HEADER, ImportFileError } from "@/lib/reading/import/formats";
import { parseImportFile, parseUploadedFile } from "@/lib/reading/import/parse";
import { fileLine } from "@/lib/reading/import/preview-text";

/* The reading import's checks on what a file holds (SLN-955): an impossible
   date is named on its row, an empty or row-less file is refused whole, and a
   rating past five stars reads as it will be saved. */

const goodreads = (cells: Record<string, string>, headers: string[] = [...GOODREADS_EXPORT_HEADER]) =>
  [headers.join(","), headers.map((h) => cells[h] ?? "").join(",")].join("\n");

describe("dates the import can't read", () => {
  it("names a Goodreads Date Read that is not a date, and imports the read undated", () => {
    const [row] = parseImportFile(goodreads({ Title: "Nana", Author: "Émile Zola", "Exclusive Shelf": "read", "Date Read": "2022/13/45" })).rows;
    expect(row.warnings).toContain("Date Read 2022/13/45 is not a date; the read will have no date");
    expect(row.readings).toHaveLength(1);
    expect(row.readings[0]).toMatchObject({ status: "finished", finishedOn: null, finishedPrecision: "unknown" });
    expect(row.error).toBeNull();
  });

  it("names a Date Started that is not a date", () => {
    const cells = { Title: "Nana", Author: "Émile Zola", "Exclusive Shelf": "read", "Date Read": "2022/03/04", "Date Started": "2022/02/30" };
    const text = goodreads(cells, [...GOODREADS_EXPORT_HEADER, "Date Started"]);
    const [row] = parseImportFile(text).rows;
    expect(row.warnings).toContain("Date Started 2022/02/30 is not a date; the read will have no start date");
    expect(row.readings[0]).toMatchObject({ finishedOn: "2022-03-04", startedOn: null });
  });

  it("says nothing of an empty date or a good one", () => {
    const [empty] = parseImportFile(goodreads({ Title: "Nana", Author: "Émile Zola", "Exclusive Shelf": "read" })).rows;
    const [good] = parseImportFile(goodreads({ Title: "Nana", Author: "Émile Zola", "Exclusive Shelf": "read", "Date Read": "2022/03/04" })).rows;
    expect(empty.warnings).toEqual([]);
    expect(good.warnings).toEqual([]);
  });

  it("names a StoryGraph Last Date Read that is not a date, when the file has no ranges", () => {
    const text = "Title,Authors,Read Status,Star Rating,Last Date Read\nNana,Émile Zola,read,,2022/13/45\n";
    const [row] = parseImportFile(text).rows;
    expect(row.warnings).toContain("Last Date Read 2022/13/45 is not a date; the read will have no date");
    expect(row.readings[0]).toMatchObject({ finishedOn: null });
  });
});

describe("files with nothing to import", () => {
  it("refuses an empty file as empty", () => {
    for (const text of ["", "﻿", " \n\r\n"]) {
      expect(() => parseImportFile(text)).toThrow(ImportFileError);
      expect(() => parseImportFile(text)).toThrow("This file is empty");
    }
  });

  it("refuses the upload of a file with only its header, which still parses as no rows", () => {
    for (const text of [`${GOODREADS_EXPORT_HEADER.join(",")}\n`, `${GOODREADS_EXPORT_HEADER.join(",")}\n,,,\n`]) {
      expect(() => parseUploadedFile(text)).toThrow(ImportFileError);
      expect(() => parseUploadedFile(text)).toThrow("This file has no rows");
      // Durtal's own export of no readings reads back as its format with no rows
      expect(parseImportFile(text)).toMatchObject({ source: "goodreads", rows: [] });
    }
  });

  it("still names an unknown file's columns before counting its rows", () => {
    expect(() => parseImportFile("Name,Price\n")).toThrow("This file is not a Goodreads, StoryGraph or Durtal export. Its columns: Name, Price");
  });
});

describe("a rating past five stars", () => {
  it("reads in the summary line as it will be saved", () => {
    const text = "Title,Authors,Read Status,Star Rating\nNana,Émile Zola,read,9\n";
    const [row] = parseImportFile(text).rows;
    expect(row.warnings).toContain("9, saved as 5");
    expect(fileLine(row, "2026-10-18")).toBe("Émile Zola · Finished, date unknown · 5 stars");
  });

  it("keeps a quarter star as the file has it", () => {
    expect(fileLine({ authors: ["A"], fileRating: 3.75, kind: "readings", readings: [] }, "2026-10-18")).toBe("A · 3.75 stars");
  });
});
