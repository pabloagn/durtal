import { describe, expect, it } from "vitest";
import { parseReviewParams, reviewMoreHref, reviewParamsSearch } from "@/lib/ebooks/review-queue/params";
import { workId, operation } from "./review-ui-fixtures";

describe("bounded review URLs", () => {
  it("defaults every section to 50 and canonicalizes real work/run identity", () => {
    const params = parseReviewParams({ work: workId.toUpperCase(), run: operation.runId });
    expect(new Set(Object.values(params.shown))).toEqual(new Set([50]));
    expect(params.filters.work).toBe(workId);
    expect(params.filters.run).toBe(operation.runId);
  });
  it("preserves all filters and other section limits when showing more", () => {
    const params = parseReviewParams({ q: "  Nadja  ", language: "French", format: "epub", hasIsbn: "no",
      work: workId, run: operation.runId, conflict: "100", likely: "150" });
    const result = new URL(reviewMoreHref(params, "conflict"), "https://durtal.test").searchParams;
    expect(Object.fromEntries(result)).toEqual({ q: "Nadja", language: "fr", format: "epub", hasIsbn: "no",
      work: workId, run: operation.runId, conflict: "150", likely: "150" });
  });
  it.each(["0", "49", "51", "501", "5000", "Infinity", "NaN", "50.5"])("refuses invalid section limit %s", (value) => {
    expect(() => parseReviewParams({ conflict: value })).toThrow();
  });
  it("caps more at 500 and omits blank/default values", () => {
    const params = parseReviewParams({ q: "", language: "", conflict: "500" });
    expect(reviewParamsSearch(params).toString()).toBe("conflict=500");
    expect(reviewMoreHref(params, "conflict")).toBe("/ebooks/review?conflict=500");
  });
  it("preserves real author and series scope through paging", () => {
    const params = parseReviewParams({ author: workId.toUpperCase(), series: operation.runId });
    expect(params.filters.author).toBe(workId);
    expect(new URL(reviewMoreHref(params, "likely"), "https://durtal.test").searchParams.get("series")).toBe(operation.runId);
    expect(() => parseReviewParams({ author: "Breton" })).toThrow();
  });
  it.each([{ q: "x".repeat(201) }, { format: "exe" }, { hasIsbn: "maybe" }, { work: "1" }, { run: "b".repeat(64) },
    { language: "not-a-language" }, { q: ["a", "b"] }])("refuses malformed filter %j", (raw) => {
    expect(() => parseReviewParams(raw)).toThrow();
  });
});
