import { describe, expect, it, vi } from "vitest";
import { cloneElement, createElement, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
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
    // People and places ask their own count, with no search or filter, whether any exist
    people: { getAuthorCount: vi.fn(async () => 0), getAuthors: vi.fn(async () => []) },
    places: { getVenueCount: vi.fn(async () => 0), getVenues: vi.fn(async () => []) },
  };
});
vi.mock("@/lib/actions/recommenders", () => actions.recommenders);
vi.mock("@/lib/actions/series", () => actions.series);
vi.mock("@/lib/actions/publishers", () => actions.publishers);
vi.mock("@/lib/actions/authors", () => actions.people);
vi.mock("@/lib/actions/venues", () => actions.places);
vi.mock("@/lib/actions/venue-pages", () => ({ getVenueCountries: async () => [] }));
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
vi.mock("@/app/(catalogue)/people/author-create-dialog", async () => ({ AuthorCreateDialog: await add("Add person") }));
vi.mock("@/app/(catalogue)/places/venue-create-dialog", async () => ({ VenueCreateDialog: await add("Add venue") }));
vi.mock("@/app/(catalogue)/recommenders/recommenders-filters-bar", async () => ({ RecommendersFiltersBar: await toolbar() }));
vi.mock("@/app/(catalogue)/series/series-filters-bar", async () => ({ SeriesFiltersBar: await toolbar() }));
vi.mock("@/app/(catalogue)/publishers/publishers-filters-bar", async () => ({ PublishersFiltersBar: await toolbar() }));
vi.mock("@/app/(catalogue)/people/authors-filters-bar", async () => ({ AuthorsFiltersBar: await toolbar() }));
vi.mock("@/app/(catalogue)/places/places-filters-bar", async () => ({ PlacesFiltersBar: await toolbar() }));
vi.mock("@/app/(catalogue)/recommenders/recommenders-shell", () => ({ RecommendersShell: () => null }));
vi.mock("@/app/(catalogue)/series/series-shell", () => ({ SeriesShell: () => null }));
vi.mock("@/app/(catalogue)/publishers/publishers-shell", () => ({ PublishersShell: () => null }));
vi.mock("@/app/(catalogue)/people/authors-shell", () => ({ AuthorsShell: () => null }));
vi.mock("@/app/(catalogue)/places/places-shell", () => ({ PlacesShell: () => null }));

import RecommendersPage from "@/app/(catalogue)/recommenders/page";
import SeriesPage from "@/app/(catalogue)/series/page";
import PublishersPage from "@/app/(catalogue)/publishers/page";
import PeoplePage from "@/app/(catalogue)/people/page";
import PlacesPage from "@/app/(catalogue)/places/page";

type Page = (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;
const pages: { name: string; page: Page; has: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; empty: string; says: string }[] = [
  { name: "recommenders", page: RecommendersPage as Page, has: actions.recommenders.hasRecommenders, list: actions.recommenders.getRecommenderList,
    empty: "No recommenders yet", says: "A recommender is whoever suggested a book to you" },
  { name: "series", page: SeriesPage as Page, has: actions.series.hasSeries, list: actions.series.getSeriesList,
    empty: "No series yet", says: "A series is a run of books that belong together in order" },
  { name: "publishers", page: PublishersPage as Page, has: actions.publishers.hasPublishers, list: actions.publishers.getPublishers,
    empty: "No publishers yet", says: "A publisher is the house, imprint or group behind an edition" },
  { name: "people", page: PeoplePage as Page, has: actions.people.getAuthorCount, list: actions.people.getAuthors,
    empty: "No people yet", says: "People are the writers, translators, directors, perfumers and painters" },
  { name: "places", page: PlacesPage as Page, has: actions.places.getVenueCount, list: actions.places.getVenues,
    empty: "No places yet", says: "A place is somewhere your works come from or live" },
];
const adds = (html: string) => html.split("data-add").length - 1;
/** The page without its streamed parts (Suspense, at any depth), and whether it streams the list */
const outer = (page: ReactNode) => {
  let streams = false;
  const strip = (node: ReactNode): ReactNode => {
    if (Array.isArray(node)) return node.map(strip);
    if (!isValidElement<{ children?: ReactNode }>(node)) return node;
    if (node.type === Suspense) { streams = true; return null; }
    return node.props.children === undefined ? node : cloneElement(node, undefined, strip(node.props.children));
  };
  const html = renderToStaticMarkup(createElement("div", null, strip(page)));
  return { html, streams };
};

describe.each(pages)("/$name", ({ page, has, list, empty, says }) => {
  it("with none, shows one empty state that says what it is, with one Add and no toolbar", async () => {
    has.mockResolvedValueOnce(0);
    const html = renderToStaticMarkup((await page({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(html).toMatch(new RegExp(`<h2[^>]*>${empty}</h2>`));
    expect(html).toContain(says);
    expect(adds(html)).toBe(1);
    expect(html).not.toContain("data-toolbar");
  });

  it("with none, a search in the address still shows the one empty state", async () => {
    has.mockResolvedValueOnce(0);
    const html = renderToStaticMarkup((await page({ searchParams: Promise.resolve({ q: "anyone" }) })) as ReactElement);
    expect(html).toContain(empty);
    expect(html).not.toContain("data-toolbar");
  });

  it("with some, keeps the toolbar and the header's Add, and streams the list", async () => {
    has.mockResolvedValueOnce(1);
    const { html, streams } = outer(await page({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain(empty);
    expect(adds(html)).toBe(1);
    expect(streams).toBe(true);
  });

  it("starts the list before the check answers: one database wave", async () => {
    list.mockClear();
    let answer!: (value: number) => void;
    has.mockReturnValueOnce(new Promise<number>((resolve) => { answer = resolve; }));
    const rendering = page({ searchParams: Promise.resolve({}) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(list).toHaveBeenCalledTimes(1);
    answer(1);
    await rendering;
  });

  it("with none, a failed list read does not go unhandled", async () => {
    has.mockResolvedValueOnce(0);
    list.mockRejectedValueOnce(new Error("connection terminated"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await page({ searchParams: Promise.resolve({}) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

it("a taxonomy family with no items has no toolbar or count line, only its empty state's New item", async () => {
  const { readFileSync } = await import("fs");
  const path = await import("path");
  const shell = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/taxonomy/[familySlug]/taxonomy-family-shell.tsx"), "utf8");
  expect(shell).toContain('{items.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-3">');
  expect(shell).toContain('{items.length > 0 && <>{items.length} item{items.length === 1 ? "" : "s"}{" · "}</>}');
  expect(shell).toMatch(/<EmptyState\s+icon=\{Tags\}\s+heading="h2"/);
});
