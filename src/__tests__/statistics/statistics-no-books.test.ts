// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// SLN-1174: with no books on the shelves, the page says so for the books and
// still shows the readings and the other collections it has.

vi.mock("@/lib/statistics/library", () => ({
  libraryNumbers: async () => ({ books: 0, editions: 0, copies: 0, pages: 0, authors: 0, publishers: 0, languages: 0, countries: 0 }),
  writtenYears: async () => ({ years: [], undated: 0 }),
  busiestYears: async () => [],
  rankings: async () => ({ languages: [], countries: [], categories: [], authors: [], publishers: [] }),
  breakdown: async () => ({ read: 0, unread: 0, rated: 0, unrated: 0, translated: 0, original: 0, print: 0, digital: 0 }),
  ratingSpread: async () => [],
  copyStats: async () => ({ formats: [], places: [], acquired: [], undated: 0 }),
  extremes: async () => ({ oldest: null, newest: null, longest: null, shortest: null }),
  favouriteCovers: async () => [],
}));
vi.mock("@/lib/reading/stats", () => ({ yearNumbers: async () => ({ books: 4, pages: 900, hours: 12, readingDays: 9 }) }));
vi.mock("@/lib/catalogue/domains", async (original) => ({ ...(await original<object>()), getEnabledWorkKinds: () => ["book", "film", "perfume"] }));
vi.mock("@/lib/catalogue/domain-homes", () => ({
  loadDomainCounts: async (kind: string) => (kind === "film" ? { records: 5, creators: 3 } : { records: 0, creators: 0 }),
}));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: () => null }));

import StatisticsPage from "@/app/(catalogue)/statistics/page";

describe("the statistics page with no books on the shelves", () => {
  it("shows the empty state for the books beside the readings and the other collections", async () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(await StatisticsPage()), "text/html");
    expect([...doc.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["No books on your shelves yet", "Reading", "The other collections"]);
    expect(doc.getElementById("numbers")).toBeNull();
    expect(doc.getElementById("reading")?.textContent).toContain("Books finished");
    expect(doc.getElementById("reading")?.textContent).toContain("Every book you finished, owned or not.");
    expect(doc.getElementById("reading")?.textContent).not.toContain("Breakdown");
    expect(doc.getElementById("collections")?.textContent).toMatch(/5Films3Directors/);
    expect(doc.getElementById("collections")?.textContent).not.toContain("Perfumes");
  });
});
