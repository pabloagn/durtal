import { describe, expect, it } from "vitest";
import { differencesOf, type DifferenceSides } from "@/lib/ebooks/differences/compare";

/* SLN-658: what counts as a difference between a library e-book and its book. */

function sides(ebook: Partial<DifferenceSides["ebook"]> = {}, durtal: Partial<DifferenceSides["durtal"]> = {}, over: Partial<DifferenceSides> = {}): DifferenceSides {
  return {
    ebookId: "e1", workId: "w1", editionId: "ed1", slug: "nadja", catalogueStatus: "accessioned", otherCopies: 0, editionLocked: false,
    ebook: { title: "Nadja", subtitle: null, authors: ["André Breton"], series: null, seriesIndex: null, language: "fr", year: null,
      publisher: null, isbns: [], hasCover: false, ...ebook },
    durtal: { workTitle: "Nadja", title: "Nadja", subtitle: null, authors: [{ name: "André Breton", creditedAs: null }], series: null,
      seriesIndex: null, language: "fr", year: null, publisher: null, isbn13: null, hasCover: false, ...durtal },
    ...over,
  };
}
const fields = (s: DifferenceSides) => differencesOf(s).map((d) => d.field);

describe("a library e-book's differences with its book", () => {
  it("ignores case, accents, punctuation and author name forms", () => {
    expect(fields(sides({ title: "NADJA!", authors: ["Breton, Andre"], language: "fre", publisher: "gallimard" }, { publisher: "Gallimard" }))).toEqual([]);
    // A title with its subtitle is the same title
    expect(fields(sides({ title: "Nadja: A Novel" }, { subtitle: "A novel" }))).toEqual([]);
    // Initials with or without spaces; a credited name counts too
    expect(fields(sides({ authors: ["M.R. James"] }, { authors: [{ name: "Montague Rhodes James", creditedAs: "M. R. James" }] }))).toEqual([]);
  });

  it("compares only what the file has", () => {
    expect(fields(sides({}, { publisher: "Gallimard", year: 1964, isbn13: "9782070360239", subtitle: "Récit", series: "Folio" }))).toEqual([]);
    expect(differencesOf(sides({ publisher: "Grove", year: 2012, isbns: ["9780802150264"] }))).toMatchObject([
      { field: "year", durtal: null, file: "2012" },
      { field: "publisher", durtal: null, file: "Grove" },
      { field: "isbn", durtal: null, file: "9780802150264" },
    ]);
    // Durtal's ISBN among the file's is no difference; another one is
    expect(fields(sides({ isbns: ["9782070360239", "9780802150264"] }, { isbn13: "9780802150264" }))).toEqual([]);
  });

  it("compares a number in a series only within the same series", () => {
    expect(fields(sides({ series: "Folio", seriesIndex: 2 }, { series: "Gallimard" }))).toEqual(["series"]);
    expect(differencesOf(sides({ series: "folio", seriesIndex: 2.5 }, { series: "Folio", seriesIndex: "2" }))).toMatchObject([
      { field: "seriesIndex", durtal: "2", file: "2.5", use: true },
    ]);
    expect(fields(sides({ series: "Folio", seriesIndex: 2 }, { series: "Folio", seriesIndex: "2.0" }))).toEqual([]);
  });

  it("says what a change to the edition also reaches, and when it is not offered", () => {
    const [year] = differencesOf(sides({ year: 2012 }, {}, { otherCopies: 2 }));
    expect(year).toMatchObject({ use: true, note: "The edition has 2 other copies, which this change also reaches." });
    expect(differencesOf(sides({ year: 2012 }, {}, { editionLocked: true }))[0]).toMatchObject({ use: false, why: "The edition's details are locked.", note: null });
    expect(differencesOf(sides({ hasCover: true }, { hasCover: true }))).toEqual([]);
    expect(differencesOf(sides({ hasCover: true }))[0]).toMatchObject({ field: "cover", keep: false, use: true });
    expect(differencesOf(sides({}, {}, { catalogueStatus: "on_order" }))[0]).toMatchObject({ field: "status", durtal: "On order", keep: false, use: false });
  });
});
