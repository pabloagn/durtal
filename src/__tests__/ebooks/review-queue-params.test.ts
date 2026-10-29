import { describe, expect, it } from "vitest";
import { parseReviewParams, reviewPageHref, reviewParamsSearch } from "@/lib/ebooks/review-queue/params";
import { workId, operation } from "./review-ui-fixtures";

describe("bounded review URLs", () => {
  it("opens the first page of no named section and canonicalizes real work/run identity", () => {
    const params = parseReviewParams({ work: workId.toUpperCase(), run: operation.runId });
    expect(params.section).toBeNull();
    expect(params.page).toBe(1);
    expect(params.filters.work).toBe(workId);
    expect(params.filters.run).toBe(operation.runId);
  });
  it("preserves all filters when it moves to another section or page (SLN-684)", () => {
    const params = parseReviewParams({ q: "  Nadja  ", language: "French", format: "epub", hasIsbn: "no",
      work: workId, run: operation.runId, section: "likely", page: "3" });
    const result = new URL(reviewPageHref(params, { section: "conflict", page: 2 }), "https://durtal.test").searchParams;
    expect(Object.fromEntries(result)).toEqual({ q: "Nadja", language: "fr", format: "epub", hasIsbn: "no",
      work: workId, run: operation.runId, section: "conflict", page: "2" });
    // Another section starts at its first page
    expect(new URL(reviewPageHref(params, { section: "duplicate" }), "https://durtal.test").searchParams.get("page")).toBeNull();
  });
  it.each(["abc", "0", "-1", "Infinity", "NaN", "2.5", "999999999999999999"])("falls back for page %s without dropping filters", (value) => {
    const params = parseReviewParams({ page: value, q: "Nadja", language: "fr", format: "epub" });
    expect(params.page).toBe(1);
    expect(params.filters).toMatchObject({ q: "Nadja", language: "fr", format: "epub" });
  });
  it("allows large valid pages for the query to clamp", () => {
    expect(parseReviewParams({ page: "5000", language: "fr" })).toMatchObject({ page: 5000, filters: { language: "fr" } });
  });
  it("refuses an unknown section and omits blank/default values", () => {
    expect(() => parseReviewParams({ section: "everything" })).toThrow();
    const params = parseReviewParams({ q: "", language: "", section: "likely", page: "1" });
    expect(reviewParamsSearch(params).toString()).toBe("section=likely");
  });
  it("preserves real author and series scope through paging", () => {
    const params = parseReviewParams({ author: workId.toUpperCase(), series: operation.runId });
    expect(params.filters.author).toBe(workId);
    expect(new URL(reviewPageHref(params, { section: "likely", page: 2 }), "https://durtal.test").searchParams.get("series")).toBe(operation.runId);
    expect(() => parseReviewParams({ author: "Breton" })).toThrow();
  });
  it.each([{ q: "x".repeat(201) }, { format: "exe" }, { hasIsbn: "maybe" }, { work: "1" }, { run: "b".repeat(64) },
    { language: "not-a-language" }, { q: ["a", "b"] }])("refuses malformed filter %j", (raw) => {
    expect(() => parseReviewParams(raw)).toThrow();
  });
  it("drops a NUL from the search, which Postgres text cannot hold (SLN-933)", () => {
    expect(parseReviewParams({ q: "\u0000" }).filters.q).toBe("");
    expect(parseReviewParams({ q: " Nad\u0000ja " }).filters.q).toBe("Nadja");
    expect(reviewParamsSearch(parseReviewParams({ q: "\u0000" })).has("q")).toBe(false);
  });
});
