import { describe, expect, it } from "vitest";
import { calibreReadingRows, requireReadColumns, type LinkedCalibreBook } from "@/lib/ebooks/calibre/reading";
import type { CalibreBook, CalibreSnapshot } from "@/lib/ebooks/calibre/library";

/* SLN-658: Calibre's ratings and reads as a reading import's rows, for the
   Calibre books that are linked e-books in Durtal. */

const LIBRARY = "5f4c1a2b-0000-4000-8000-00000000000a";

function book(id: number, over: Partial<CalibreBook> = {}): CalibreBook {
  return {
    id,
    uuid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    title: `Book ${id}`,
    titleSort: null,
    authors: [{ name: "Samuel Beckett", sort: "Beckett, Samuel" }],
    authorSort: null,
    series: null,
    seriesIndex: null,
    publisher: null,
    pubdate: null,
    languages: ["eng"],
    identifiers: [],
    tags: [],
    rating: null,
    description: null,
    hasCover: false,
    coverPath: null,
    path: `Samuel Beckett/Book ${id} (${id})`,
    added: null,
    lastModified: null,
    formats: [],
    custom: {},
    ...over,
  };
}

function snapshot(books: CalibreBook[]): CalibreSnapshot {
  return {
    library: { id: LIBRARY, path: "/Volumes/Books/Calibre Library", volumeUuid: null, mountPoint: null },
    columns: [
      { label: "read", name: "Read", type: "bool", isMultiple: false },
      { label: "readdate", name: "Date read", type: "datetime", isMultiple: false },
      { label: "shelf", name: "Shelves", type: "text", isMultiple: true },
    ],
    books,
  } as unknown as CalibreSnapshot;
}

const link = (b: CalibreBook): LinkedCalibreBook => ({ uuid: b.uuid.toUpperCase(), workId: `w${b.id}`, editionId: `e${b.id}`, instanceId: `i${b.id}` });

describe("a Calibre library's ratings and reads as reading import rows", () => {
  const read = book(1, { rating: 4, custom: { read: true, readdate: "2020-01-01T23:30:00.000Z" }, identifiers: [{ type: "isbn", value: "978-0-14-044913-6" }] });
  const undated = book(2, { custom: { read: true } });
  const rated = book(3, { rating: 3.5 });
  const contradicted = book(4, { custom: { read: false, readdate: "2019-05-04T10:00:00.000Z" } });
  const nothing = book(5, { custom: { read: false } });
  const unlinked = book(6, { rating: 5, custom: { read: true } });
  const library = snapshot([read, undated, rated, contradicted, nothing, unlinked]);
  const linked = [read, undated, rated, contradicted, nothing].map(link);

  it("makes one row for each linked book with a rating or a read, numbered by Calibre's id", () => {
    const { rows, rowNos } = calibreReadingRows(library, linked, { read: "#read", readDate: "readdate" }, "Europe/Amsterdam");
    expect(rowNos).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => [r.title, r.rating, r.readings.length, r.workId, r.editionId, r.instanceId])).toEqual([
      ["Book 1", 4, 1, "w1", "e1", "i1"],
      ["Book 2", null, 1, "w2", "e2", "i2"],
      ["Book 3", 3.5, 0, "w3", "e3", "i3"],
      ["Book 4", null, 0, "w4", "e4", "i4"],
    ]);
    // The read date is the calendar date where Durtal is, not UTC's
    expect(rows[0].readings[0]).toMatchObject({
      status: "finished",
      finishedOn: "2020-01-02",
      finishedPrecision: "day",
      format: "ebook",
      rating: null,
      sourceKey: `ebook-library:${LIBRARY}:${read.uuid}#1`,
    });
    expect(rows[0]).toMatchObject({ kind: "readings", isbn13: "9780140449136", fileRating: 4, sourceBookId: null, error: null });
    expect(rows[1].readings[0]).toMatchObject({ finishedOn: null, finishedPrecision: "unknown", note: "Read, date unknown" });
    // The columns disagree: shown and never imported; with a rating, the rating still is
    expect(rows[3]).toMatchObject({ warnings: [], error: "The library has a read date (2019-05-04) but says the book was not read: no read is imported" });
    const [withRating] = calibreReadingRows(snapshot([{ ...contradicted, rating: 2 }]), linked, { read: "read", readDate: "readdate" }, "Europe/Amsterdam").rows;
    expect(withRating).toMatchObject({ rating: 2, readings: [], error: null, warnings: ["The library has a read date (2019-05-04) but says the book was not read: no read is imported"] });
  });

  it("takes a dated book as read when only the date column is named", () => {
    const { rows } = calibreReadingRows(library, linked, { readDate: "readdate" }, "Europe/Amsterdam");
    expect(rows.map((r) => [r.title, r.readings.map((x) => x.finishedOn)])).toEqual([
      ["Book 1", ["2020-01-02"]],
      ["Book 3", []],
      ["Book 4", ["2019-05-04"]],
    ]);
  });

  it("refuses a column the snapshot lacks, one of another kind, and no column at all", () => {
    expect(() => requireReadColumns(library, { read: "#finished" })).toThrow("The column #finished is not in the snapshot: its yes/no columns are #read. Nothing created.");
    expect(() => requireReadColumns(library, { readDate: "shelf" })).toThrow("The column #shelf holds text values, not date ones.");
    expect(() => requireReadColumns(library, {})).toThrow("Name the column that says a book was read");
    expect(() => calibreReadingRows(library, linked, { read: "nope" })).toThrow("is not in the snapshot");
  });
});
