import { describe, it, expect } from "vitest";
import { clearedListHref, firstPageHref, hasListQuery } from "@/lib/utils/list-params";

const params = (qs: string) => new URLSearchParams(qs);

// ── clearedListHref ────────────────────────────────────────────────────────────

describe("clearedListHref", () => {
  it("removes the search, filters and page", () => {
    expect(
      clearedListHref("/authors", params("q=zzz&nationality=HU&gender=male&page=3")),
    ).toBe("/authors");
  });

  it("keeps sort and order", () => {
    expect(
      clearedListHref("/authors", params("q=zzz&sort=birth&order=desc&alive=true")),
    ).toBe("/authors?sort=birth&order=desc");
  });

  it("returns the bare path when nothing is set", () => {
    expect(clearedListHref("/places", params(""))).toBe("/places");
  });
});

// ── firstPageHref ──────────────────────────────────────────────────────────────

describe("firstPageHref", () => {
  it("removes only the page", () => {
    expect(firstPageHref("/authors", params("q=bor&page=9&sort=name"))).toBe(
      "/authors?q=bor&sort=name",
    );
  });

  it("returns the bare path when page was the only param", () => {
    expect(firstPageHref("/authors", params("page=2"))).toBe("/authors");
  });
});

// ── hasListQuery ───────────────────────────────────────────────────────────────

describe("hasListQuery", () => {
  it("is false with no params", () => {
    expect(hasListQuery(params(""))).toBe(false);
  });

  it("is false with only sort, order and page", () => {
    expect(hasListQuery(params("sort=name&order=desc&page=2"))).toBe(false);
  });

  it("is true with a search term", () => {
    expect(hasListQuery(params("q=borges"))).toBe(true);
  });

  it("is true with a filter", () => {
    expect(hasListQuery(params("nationality=HU"))).toBe(true);
    expect(hasListQuery(params("birthYearMin=1900"))).toBe(true);
  });

  it("ignores empty values", () => {
    expect(hasListQuery(params("q=&nationality="))).toBe(false);
  });
});
