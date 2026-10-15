import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// SLN-834 and its follow-up: an index page with nothing is its title and one
// empty state that says what the thing is, with one Add, and no toolbar over
// nothing. With some, the toolbar and the header's Add stay. Either way the
// list is read alongside the check, not after it: one database wave.

const actions = vi.hoisted(() => {
  const list = () => vi.fn(async () => ({ rows: [] as unknown[], total: 0 }));
  return {
    recommenders: { hasRecommenders: vi.fn(async () => false), getRecommenderList: list() },
    series: { hasSeries: vi.fn(async () => false), getSeriesList: list(), getSeriesSuggestions: vi.fn(async () => []) },
    publishers: { hasPublishers: vi.fn(async () => false), getPublishers: list(), getPublisherCountries: vi.fn(async () => []) },
  };
});
vi.mock("@/lib/actions/recommenders", () => actions.recommenders);
vi.mock("@/lib/actions/series", () => actions.series);
vi.mock("@/lib/actions/publishers", () => actions.publishers);
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...(href.endsWith("/new") ? { "data-add": "" } : {}) }, children),
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) =>
    createElement("header", null, createElement("h1", null, title), actions),
}));
// The Add buttons and the toolbars, as marks the tests count
const { add, toolbar } = vi.hoisted(() => ({
  add: async (label: string) => {
    const { createElement } = await import("react");
    return () => createElement("button", { "data-add": "" }, label);
  },
  toolbar: async () => {
    const { createElement } = await import("react");
    return () => createElement("div", { "data-toolbar": "" });
  },
}));
vi.mock("@/components/recommenders/recommender-form-dialog", async () => ({ RecommenderFormDialog: await add("Add recommender") }));
vi.mock("@/components/series/series-form-dialog", async () => ({ SeriesFormDialog: await add("Add series") }));
vi.mock("@/app/(catalogue)/recommenders/recommenders-filters-bar", async () => ({ RecommendersFiltersBar: await toolbar() }));
vi.mock("@/app/(catalogue)/series/series-filters-bar", async () => ({ SeriesFiltersBar: await toolbar() }));
vi.mock("@/app/(catalogue)/publishers/publishers-filters-bar", async () => ({ PublishersFiltersBar: await toolbar() }));
vi.mock("@/app/(catalogue)/recommenders/recommenders-shell", () => ({ RecommendersShell: () => null }));
vi.mock("@/app/(catalogue)/series/series-shell", () => ({ SeriesShell: () => null }));
vi.mock("@/app/(catalogue)/publishers/publishers-shell", () => ({ PublishersShell: () => null }));

import RecommendersPage from "@/app/(catalogue)/recommenders/page";
import SeriesPage from "@/app/(catalogue)/series/page";
import PublishersPage from "@/app/(catalogue)/publishers/page";

type Page = (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;
const pages: { name: string; page: Page; has: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; empty: string; says: string }[] = [
  { name: "recommenders", page: RecommendersPage as Page, has: actions.recommenders.hasRecommenders, list: actions.recommenders.getRecommenderList,
    empty: "No recommenders yet", says: "A recommender is whoever suggested a book to you" },
  { name: "series", page: SeriesPage as Page, has: actions.series.hasSeries, list: actions.series.getSeriesList,
    empty: "No series yet", says: "A series is a run of books that belong together in order" },
  { name: "publishers", page: PublishersPage as Page, has: actions.publishers.hasPublishers, list: actions.publishers.getPublishers,
    empty: "No publishers yet", says: "A publisher is the house, imprint or group behind an edition" },
];
const adds = (html: string) => html.split("data-add").length - 1;
/** The page without its streamed parts (Suspense), and whether it streams the list */
const outer = (page: ReactNode) => {
  const children = ([] as ReactNode[]).concat((page as ReactElement<{ children: ReactNode }>).props.children);
  return {
    html: renderToStaticMarkup(createElement("div", null, children.filter((n) => !(isValidElement(n) && n.type === Suspense)))),
    streams: children.some((n) => isValidElement(n) && n.type === Suspense),
  };
};

describe.each(pages)("/$name", ({ page, has, list, empty, says }) => {
  it("with none, shows one empty state that says what it is, with one Add and no toolbar", async () => {
    has.mockResolvedValueOnce(false);
    const html = renderToStaticMarkup((await page({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(html).toMatch(new RegExp(`<h2[^>]*>${empty}</h2>`));
    expect(html).toContain(says);
    expect(adds(html)).toBe(1);
    expect(html).not.toContain("data-toolbar");
  });

  it("with none, a search in the address still shows the one empty state", async () => {
    has.mockResolvedValueOnce(false);
    const html = renderToStaticMarkup((await page({ searchParams: Promise.resolve({ q: "anyone" }) })) as ReactElement);
    expect(html).toContain(empty);
    expect(html).not.toContain("data-toolbar");
  });

  it("with some, keeps the toolbar and the header's Add, and streams the list", async () => {
    has.mockResolvedValueOnce(true);
    const { html, streams } = outer(await page({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain(empty);
    expect(adds(html)).toBe(1);
    expect(streams).toBe(true);
  });

  it("starts the list before the check answers: one database wave", async () => {
    list.mockClear();
    let answer!: (value: boolean) => void;
    has.mockReturnValueOnce(new Promise<boolean>((resolve) => { answer = resolve; }));
    const rendering = page({ searchParams: Promise.resolve({}) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(list).toHaveBeenCalledTimes(1);
    answer(true);
    await rendering;
  });

  it("with none, a failed list read does not go unhandled", async () => {
    has.mockResolvedValueOnce(false);
    list.mockRejectedValueOnce(new Error("connection terminated"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await page({ searchParams: Promise.resolve({}) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
