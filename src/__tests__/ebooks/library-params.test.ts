import { describe, expect, it } from "vitest";
import { parseEbookLibraryParams } from "@/lib/ebooks/library-params";

describe("ebook library URL parameters", () => {
  it("defaults to title ascending and 48 active records", () => {
    expect(parseEbookLibraryParams({})).toMatchObject({
      state: "active",
      sort: "title",
      explicitSort: false,
      order: "asc",
      page: 1,
      perPage: 48,
    });
  });
  it("combines distinct groups, bounds lists and normalizes language/search", () => {
    const p = parseEbookLibraryParams(
      new URLSearchParams(
        "q=N%C3%A1dja&format=epub,pdf&format=epub,bad&language=fra,en-US,not-a-language&linked=linked,standalone,bad&drm=yes&review=no",
      ),
    );
    expect(p).toMatchObject({
      normalizedSearch: "nadja",
      formats: ["epub", "pdf"],
      languages: ["fr", "en"],
      linked: ["linked", "standalone"],
      drm: true,
      needsReview: false,
    });
  });
  it("refuses SQL-like sort/order/format and huge page values before queries", () => {
    const p = parseEbookLibraryParams({
      sort: "title;delete from ebooks",
      order: "desc;drop table",
      format: "epub');drop table",
      page: "999999999999999999999",
      perPage: "7000",
    });
    expect(p).toMatchObject({
      sort: "title",
      order: "asc",
      formats: [],
      page: 1,
      perPage: 48,
    });
  });
  it("remembers explicit directions and the Set aside view with shared page sizes", () => {
    expect(
      parseEbookLibraryParams({
        state: "excluded",
        sort: "size",
        order: "asc",
        page: "2",
        perPage: "192",
      }),
    ).toMatchObject({
      state: "excluded",
      sort: "size",
      explicitSort: true,
      order: "asc",
      offset: 192,
    });
    expect(parseEbookLibraryParams({ sort: "opened" }).order).toBe("desc");
  });
  it("bounds search while preserving a literal user query for its empty state", () => {
    const p = parseEbookLibraryParams({ q: "  " + "É".repeat(300) + "  " });
    expect(p.q).toHaveLength(200);
    expect(p.normalizedSearch).toBe("e".repeat(200));
  });
  it("drops a NUL from the search, which Postgres text cannot hold (SLN-933)", () => {
    expect(parseEbookLibraryParams(new URLSearchParams("q=%00")).q).toBe("");
    expect(parseEbookLibraryParams({ q: "nad\u0000ja" }).q).toBe("nadja");
  });
});
