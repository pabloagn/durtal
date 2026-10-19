import { describe, expect, it } from "vitest";
import { GROUPS_PER_PAGE, highlightReaderHref, parseHighlightParams } from "@/lib/ebooks/highlights";

const BOOK = "0E6F1B4A-1C7E-4C55-9D2B-3B1C2D4E5F60";

describe("parseHighlightParams (SLN-500)", () => {
  it("drops a NUL from the search, so it never reaches Postgres (SLN-933)", () => {
    expect(parseHighlightParams({ q: "\u0000" })).toMatchObject({ q: "", words: [] });
    expect(parseHighlightParams({ q: "nad\u0000ja" })).toMatchObject({ q: "nadja", words: ["nadja"] });
  });

  it("defaults to every live mark, newest book first", () => {
    expect(parseHighlightParams({})).toMatchObject({
      q: "",
      words: [],
      colors: [],
      kinds: [],
      ebookId: null,
      sort: "newest",
      order: "desc",
      page: 1,
    });
  });

  it("keeps only known colours and kinds, deduplicated, from comma lists or repeated keys", () => {
    const params = parseHighlightParams(new URLSearchParams("color=ochre,neon,ochre&color=sage&kind=note,shout"));
    expect(params.colors).toEqual(["ochre", "sage"]);
    expect(params.kinds).toEqual(["note"]);
  });

  it("accepts one e-book id, lower-cased, and drops anything else", () => {
    expect(parseHighlightParams({ ebook: BOOK }).ebookId).toBe(BOOK.toLowerCase());
    expect(parseHighlightParams({ ebook: "../etc" }).ebookId).toBeNull();
  });

  it("sorts by title ascending unless an order is given, and ignores unknown sorts", () => {
    expect(parseHighlightParams({ sort: "title" })).toMatchObject({ sort: "title", order: "asc" });
    expect(parseHighlightParams({ sort: "title", order: "desc" }).order).toBe("desc");
    expect(parseHighlightParams({ sort: "random" })).toMatchObject({ sort: "newest", order: "desc" });
  });

  it("pages a fixed number of books, or one book's marks like any list", () => {
    expect(parseHighlightParams({ perPage: "192" })).toMatchObject({ perPage: GROUPS_PER_PAGE, offset: 0 });
    expect(parseHighlightParams({ page: "3" })).toMatchObject({ perPage: GROUPS_PER_PAGE, offset: 2 * GROUPS_PER_PAGE });
    expect(parseHighlightParams({ ebook: BOOK, page: "2" })).toMatchObject({ perPage: 48, offset: 48 });
    expect(parseHighlightParams({ ebook: BOOK, perPage: "24", page: "2" })).toMatchObject({ perPage: 24, offset: 24 });
  });

  it("keeps the search's words as typed, for the database to fold (SLN-1234)", () => {
    const params = parseHighlightParams({ q: "  Huysmans, À REBOURS " });
    expect(params.q).toBe("Huysmans, À REBOURS");
    expect(params.words).toEqual(["Huysmans", "À", "REBOURS"]);
    expect(parseHighlightParams({ q: "한강 で" }).words).toEqual(["한강", "で"]);
  });
});

describe("highlightReaderHref", () => {
  it("opens the reader at the mark and returns to the list", () => {
    const href = highlightReaderHref("b1", "m1", "/ebooks/highlights?color=ochre&page=2");
    const url = new URL(href, "http://durtal.test");
    expect(url.pathname).toBe("/reader/b1");
    expect(url.searchParams.get("at")).toBe("m1");
    expect(url.searchParams.get("returnTo")).toBe("/ebooks/highlights?color=ochre&page=2");
  });
});
