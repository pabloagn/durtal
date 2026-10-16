// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import path from "path";
import { originsTitle } from "@/lib/statistics/charts";

// Design polish 3, items 9 and 10: no page count is not "0 Pages" but a dash (SLN-824),
// and the origins section is titled by the lists it shows (SLN-825)

const state = vi.hoisted(() => ({
  pages: 600,
  ranks: { languages: [] as unknown[], countries: [] as unknown[], categories: [] as unknown[], authors: [], publishers: [] },
}));
vi.mock("@/lib/statistics/library", () => ({
  libraryNumbers: async () => ({ books: 2, editions: 2, copies: 2, pages: state.pages, authors: 1, publishers: 0, languages: 1, countries: 0 }),
  writtenYears: async () => ({ years: [], undated: 0 }),
  busiestYears: async () => [],
  rankings: async () => state.ranks,
  breakdown: async () => ({ read: 0, unread: 2, rated: 0, unrated: 2, translated: 0, original: 2, print: 2, digital: 0 }),
  ratingSpread: async () => [],
  copyStats: async () => ({ formats: [], places: [], acquired: [], undated: 0 }),
  extremes: async () => ({ oldest: null, newest: null, longest: null, shortest: null }),
  favouriteCovers: async () => [],
}));
vi.mock("@/lib/reading/stats", () => ({ yearNumbers: async () => ({ books: 0, pages: 0, hours: 0, readingDays: 0 }) }));
vi.mock("@/lib/catalogue/domains", async (original) => ({ ...(await original<object>()), getEnabledWorkKinds: () => ["book"] }));
vi.mock("@/lib/catalogue/domain-homes", () => ({ loadDomainCounts: async () => ({ records: 0, creators: 0 }) }));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: () => null }));

import StatisticsPage from "@/app/(catalogue)/statistics/page";

const render = async () => new DOMParser().parseFromString(renderToStaticMarkup(await StatisticsPage()), "text/html");
const tiles = (page: Document) => [...page.querySelectorAll('[data-stats-section="numbers"] dt')].map((dt) => dt.textContent);
const language = { key: "fr", count: 2 };

describe("the Pages tile", () => {
  it("shows the pages when a book has a page count", async () => {
    state.pages = 600;
    expect(tiles(await render())).toEqual(["Books", "Editions", "Owned copies", "Pages", "Authors", "Publishers", "Languages", "Authors' countries"]);
  });

  it("shows a dash, not 0, when no book has one, and keeps the rows full", async () => {
    state.pages = 0;
    const page = await render();
    expect(tiles(page)).toEqual(["Books", "Editions", "Owned copies", "No page counts yet", "Authors", "Publishers", "Languages", "Authors' countries"]);
    const dash = [...page.querySelectorAll('[data-stats-section="numbers"] dt')].find((dt) => dt.textContent === "No page counts yet");
    expect(dash?.previousElementSibling?.textContent).toBe("\u2014");
    expect(page.body.textContent).not.toMatch(/0\s*Pages/);
  });

  it("is the same on the dashboard's statistics", () => {
    const source = readFileSync(path.resolve(__dirname, "../../components/statistics/dashboard-statistics.tsx"), "utf8");
    expect(source).toContain('numbers.pages > 0 ? { label: "Pages on your shelves", value: n(numbers.pages) } : { label: "No page counts yet", value: "\\u2014" }');
  });
});

describe("the languages, countries and categories section", () => {
  it("names only the lists it shows", async () => {
    state.ranks = { ...state.ranks, languages: [language], countries: [], categories: [] };
    const page = await render();
    expect(page.querySelector('[data-stats-section="origins"] h2')?.textContent).toBe("Languages");
    expect(page.body.textContent).not.toContain("countries and categories");
  });

  it("names all three when all three show", async () => {
    state.ranks = {
      ...state.ranks,
      languages: [language],
      countries: [{ key: "FR", name: "France", count: 2 }],
      categories: [{ key: "novel", name: "Novel", count: 2 }],
    };
    expect((await render()).querySelector('[data-stats-section="origins"] h2')?.textContent).toBe("Languages, countries and categories");
  });

  it("joins the lists in words", () => {
    expect(originsTitle({ languages: true, countries: false, categories: false })).toBe("Languages");
    expect(originsTitle({ languages: false, countries: true, categories: false })).toBe("Countries");
    expect(originsTitle({ languages: false, countries: false, categories: true })).toBe("Categories");
    expect(originsTitle({ languages: true, countries: true, categories: false })).toBe("Languages and countries");
    expect(originsTitle({ languages: true, countries: false, categories: true })).toBe("Languages and categories");
    expect(originsTitle({ languages: false, countries: true, categories: true })).toBe("Countries and categories");
    expect(originsTitle({ languages: true, countries: true, categories: true })).toBe("Languages, countries and categories");
  });
});
