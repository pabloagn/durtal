import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { cloneElement, createElement, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// SLN-842, second half: Books, Films, Perfumes, Paintings and Organizations
// with nothing in them are the title, any collection tabs, and one empty
// state that says what the thing is, with one Add. No toolbar over nothing,
// no Add in the header, and none of Books' "Identify editions". With some,
// the toolbar and the header's Add stay.

const actions = vi.hoisted(() => ({
  works: { getWorkCount: vi.fn(async (..._args: unknown[]) => 0), getWorks: vi.fn(async () => [] as unknown[]) },
  films: { getFilmCount: vi.fn(async () => 0), getFilms: vi.fn(async () => []) },
  perfumes: { getPerfumeCount: vi.fn(async () => 0) },
  paintings: { getPaintingCount: vi.fn(async () => 0) },
  organizations: {
    getOrganizationRoleCounts: vi.fn(async (query?: string) => ({ all: query ? 0 : 0, roles: {} })),
    getOrganizationDirectory: vi.fn(async () => ({ rows: [], total: 0 })),
  },
}));
vi.mock("@/lib/actions/works", () => actions.works);
vi.mock("@/lib/actions/films", () => actions.films);
vi.mock("@/lib/actions/perfumes", () => actions.perfumes);
vi.mock("@/lib/actions/paintings", () => actions.paintings);
vi.mock("@/lib/actions/organization-directory", () => actions.organizations);
vi.mock("@/lib/ebooks/catalogue-availability", () => ({ catalogueAvailability: async () => new Map() }));
vi.mock("@/lib/s3/media-url", () => ({ mediaUrl: () => "" }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, actions, tabs }: { title: string; actions?: ReactNode; tabs?: ReactNode }) =>
    createElement("header", null, createElement("h1", null, title), tabs, actions),
}));
// The Add buttons, the tabs and the toolbars, as marks the tests count
const { mark } = vi.hoisted(() => ({
  mark: async (attribute: string, label?: string) => {
    const { createElement } = await import("react");
    return () => createElement("div", { [attribute]: "" }, label);
  },
}));
vi.mock("@/components/domains/domain-add-link", async () => ({ DomainAddLink: await mark("data-add", "Add") }));
vi.mock("@/components/organizations/organization-dialog", async () => ({ AddOrganizationButton: await mark("data-add", "Add organization") }));
vi.mock("@/components/domains/domain-switch", async () => ({ DomainSwitch: await mark("data-tabs") }));
vi.mock("@/app/(catalogue)/library/library-header", async () => ({
  LibraryHeader: await mark("data-library-header", "Identify editions"),
  LibraryPending: () => null,
}));
vi.mock("@/app/(catalogue)/library/library-filters-bar", async () => ({ LibraryFiltersBar: await mark("data-toolbar") }));
vi.mock("@/app/(catalogue)/library/library-shell", () => ({ LibraryShell: () => null }));
vi.mock("@/components/shared/list-pending", () => ({
  ListPendingProvider: ({ children }: { children: ReactNode }) => children,
  ListPendingSwap: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/films/film-filters", async () => ({ FilmFilters: await mark("data-toolbar") }));
vi.mock("@/components/films/film-grid", () => ({ FilmGrid: () => null }));
vi.mock("@/components/perfumes/perfume-filters", async () => ({ PerfumeFilters: await mark("data-toolbar") }));
vi.mock("@/app/(catalogue)/perfumes/(list)/perfume-results", () => ({ PerfumeResults: () => null }));
vi.mock("@/components/paintings/painting-filters", async () => ({ PaintingFilters: await mark("data-toolbar") }));
vi.mock("@/app/(catalogue)/paintings/(list)/painting-results", () => ({ PaintingResults: () => null }));
vi.mock("@/components/organizations/organization-filters", async () => ({ OrganizationFilters: await mark("data-toolbar") }));
vi.mock("@/components/organizations/organization-list", () => ({ OrganizationList: () => null }));

import LibraryPage from "@/app/(catalogue)/library/(list)/page";
import FilmsPage from "@/app/(catalogue)/films/(list)/page";
import PerfumesPage from "@/app/(catalogue)/perfumes/(list)/page";
import PaintingsPage from "@/app/(catalogue)/paintings/(list)/page";
import OrganizationsPage from "@/app/(catalogue)/organizations/(list)/page";

type Page = (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;
const organizationsCount = (all: number) => async () => ({ all, roles: {} });
const pages: { name: string; page: Page; set: (n: number) => void; empty: string; says: string; tabs: boolean }[] = [
  { name: "library", page: LibraryPage as Page, set: (n) => actions.works.getWorkCount.mockResolvedValue(n),
    empty: "No books yet", says: "A book is a work you own, have read or want", tabs: true },
  { name: "films", page: FilmsPage as Page, set: (n) => actions.films.getFilmCount.mockResolvedValue(n),
    empty: "No films yet", says: "A film keeps its directors, cast", tabs: true },
  { name: "perfumes", page: PerfumesPage as Page, set: (n) => actions.perfumes.getPerfumeCount.mockResolvedValue(n),
    empty: "No perfumes yet", says: "A perfume keeps its house, perfumers, notes", tabs: true },
  { name: "paintings", page: PaintingsPage as Page, set: (n) => actions.paintings.getPaintingCount.mockResolvedValue(n),
    empty: "No paintings yet", says: "A painting keeps its painters, date", tabs: true },
  { name: "organizations", page: OrganizationsPage as Page,
    // A search counts only what it matches: with a stale one, the page asks for every organization too
    set: (n) => actions.organizations.getOrganizationRoleCounts.mockImplementation(async (query?: string) => organizationsCount(query ? 0 : n)()),
    empty: "No organizations yet", says: "An organization is a house, studio, museum or shop", tabs: false },
];
const count = (html: string, attribute: string) => html.split(attribute).length - 1;
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

describe.each(pages)("/$name", ({ page, set, empty, says, tabs }) => {
  it("with none, shows one empty state that says what it is, with one Add and no toolbar", async () => {
    set(0);
    const html = renderToStaticMarkup((await page({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(html).toMatch(new RegExp(`<h2[^>]*>${empty}</h2>`));
    expect(html).toContain(says);
    expect(count(html, "data-add")).toBe(1);
    expect(html).not.toContain("data-toolbar");
    expect(html).not.toContain("Identify editions");
    // The collection tabs stay, so the other collections are a click away
    expect(count(html, "data-tabs")).toBe(tabs ? 1 : 0);
  });

  it("with none, a search in the address still shows the one empty state", async () => {
    set(0);
    const html = renderToStaticMarkup((await page({ searchParams: Promise.resolve({ q: "anything" }) })) as ReactElement);
    expect(html).toContain(empty);
    expect(html).not.toContain("data-toolbar");
  });

  it("with some, keeps the toolbar and the header, and streams the list", async () => {
    set(3);
    const { html, streams } = outer(await page({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain(empty);
    expect(html).toContain("data-toolbar");
    expect(streams).toBe(true);
  });
});

describe("/library reads its books in one wave", () => {
  it("starts the list before the check answers", async () => {
    actions.works.getWorks.mockClear();
    let answer!: (value: number) => void;
    actions.works.getWorkCount.mockReturnValueOnce(new Promise<number>((resolve) => { answer = resolve; }));
    const rendering = LibraryPage({ searchParams: Promise.resolve({}) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(actions.works.getWorks).toHaveBeenCalledTimes(1);
    answer(1);
    await rendering;
  });

  it("with none, a failed list read does not go unhandled", async () => {
    actions.works.getWorkCount.mockResolvedValue(0);
    actions.works.getWorks.mockRejectedValueOnce(new Error("connection terminated"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await LibraryPage({ searchParams: Promise.resolve({}) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

// eBooks and the Reading tabs read many sources; their empty branches are
// checked in their source
const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("/ebooks with none", () => {
  const page = source("app/(catalogue)/ebooks/page.tsx");
  it("has no state counts or menu over nothing, and one Upload", () => {
    const empty = page.slice(page.indexOf("counts.active + counts.excluded === 0"), page.indexOf("const base ="));
    expect(empty).toMatch(/<EmptyIndex[\s\S]*?title="eBooks"[\s\S]*?empty="No eBooks yet"[\s\S]*?description="An eBook is a file/);
    expect(empty.match(/Upload eBooks/g)).toHaveLength(1);
    expect(empty).not.toContain("EbooksMenu");
    // Before the state counts and the list: they are never drawn over nothing
    expect(page.indexOf("counts.active + counts.excluded === 0")).toBeLessThan(page.indexOf('aria-label="eBook states"'));
  });
});

describe("the Reading tabs with nothing", () => {
  it("Now has one Start a book, the header's, and a sentence", () => {
    const page = source("app/(catalogue)/reading/(tabs)/page.tsx");
    const empty = page.slice(page.indexOf("{empty ? ("), page.indexOf(") : ("));
    expect(empty).toContain('title="Nothing read yet"');
    expect(empty).toContain("description=");
    expect(empty).not.toContain("StartBookButton");
    expect(empty).toContain('href="/reading/import"');
  });

  it("Journal has no filters over nothing, a sentence, and no second Start a book", () => {
    const page = source("app/(catalogue)/reading/(tabs)/journal/page.tsx");
    const empty = page.slice(page.indexOf("if (formats.length === 0)"), page.lastIndexOf("<JournalFilters"));
    expect(empty).toMatch(/title="No readings yet"\s+description="The journal keeps each time you read a book/);
    expect(empty).not.toContain("JournalFilters");
    expect(empty).not.toContain("action=");
    expect(page).not.toContain("StartBookButton");
  });

  it("Notes has its one Add in the empty state, none in the header", () => {
    const page = source("app/(catalogue)/reading/(tabs)/notes/page.tsx");
    const empty = page.slice(page.indexOf("if (facets.total === 0)"), page.indexOf("actions={<AddQuoteButton"));
    expect(empty).toContain('<PageHeader title="Reading" tabs={<ReadingTabs />} />');
    expect(empty).toMatch(/title="No quotes yet"\s+description="A quote is a passage you keep from a book/);
    expect(empty.match(/AddQuoteButton/g)).toHaveLength(1);
    expect(empty).not.toContain("NotesFilters");
  });
});
