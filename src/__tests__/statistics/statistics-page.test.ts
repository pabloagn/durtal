// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// SLN-742 review: the page against fixed numbers. A long author name never
// stretches an edge's cover frame, and "not finished" is not the unread pile.

const book = (title: string, author: string | null, value: number) => ({ workId: title, slug: null, title, author, cover: null, value });
vi.mock("@/lib/statistics/library", () => ({
  libraryStatistics: async () => ({
    numbers: { books: 3, editions: 3, copies: 3, pages: 600, authors: 2, publishers: 1, languages: 1, countries: 1 },
    written: { years: [], undated: 0 },
    busiest: [],
    rankings: { languages: [], countries: [], categories: [], authors: [], publishers: [] },
    breakdown: { read: 1, unread: 2, rated: 0, unrated: 3, translated: 0, original: 3, print: 3, digital: 0 },
    ratings: [],
    copies: { formats: [], places: [], acquired: [], undated: 0 },
    extremes: {
      oldest: book("Against Nature", "Maximiliana Wilhelmina Konstantinopolous-Abercrombie de la Fontaine", 1884),
      newest: book("En Route", null, 1895),
      longest: null,
      shortest: null,
    },
    favourites: [],
  }),
}));
vi.mock("@/lib/reading/stats", () => ({ yearNumbers: async () => ({ books: 0, pages: 0, hours: 0, readingDays: 0 }) }));
vi.mock("@/lib/catalogue/domain-homes", () => ({ loadDomainCounts: async () => ({ records: 0, creators: 0 }) }));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: () => null }));

import StatisticsPage from "@/app/(catalogue)/statistics/page";

describe("the statistics page", () => {
  it("keeps each edge's cover at the top of its row, whatever the length of its words", async () => {
    const html = renderToStaticMarkup(await StatisticsPage());
    const edge = new DOMParser().parseFromString(html, "text/html").querySelector('[data-stats-edge="Oldest"] a');
    // A stretched flex item draws the cover's shadow and frame below the cover
    expect(edge?.className.split(" ")).toContain("items-start");
  });

  it("does not call a book being read unread", async () => {
    const html = renderToStaticMarkup(await StatisticsPage());
    expect(html).toContain("Not finished");
    expect(html).not.toMatch(/>Unread</);
  });
});
