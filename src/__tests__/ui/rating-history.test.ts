import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RatingHistory } from "@/components/reading/rating-history";

describe("re-read rating history", () => {
  it("names unrated readings and keeps exact short values", () => {
    const html = renderToStaticMarkup(createElement(RatingHistory, { title: "A book", ratings: [1.5, null, 4.25] }));
    expect(html).toContain("Rated 1.5, then unrated, then 4.25");
    expect(html).not.toContain("<details");
  });

  it("keeps every long history entry in order behind a named native disclosure", () => {
    const ratings = Array.from({ length: 278 }, (_, i) => i % 3 ? 0.5 + (i % 10) / 2 : null);
    const html = renderToStaticMarkup(createElement(RatingHistory, { title: "The long book", ratings }));
    expect(html).toContain('aria-label="Show all 278 ratings for The long book"');
    expect(html).not.toContain("<details open");
    const entries = [...html.matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
    expect(entries).toEqual(ratings.map((value) => value === null ? "unrated" : String(value)));
  });

  it("keeps an absent history empty", () => {
    expect(renderToStaticMarkup(createElement(RatingHistory, { title: "A book", ratings: [] }))).toBe("");
  });
});
