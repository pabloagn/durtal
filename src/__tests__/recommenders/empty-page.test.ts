import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// SLN-834: with no recommenders the page is one empty state with one Add,
// no toolbar over nothing; with some, the toolbar and the header's Add stay.

const actions = vi.hoisted(() => ({
  hasRecommenders: vi.fn(async () => false),
  getRecommenderList: vi.fn(async () => ({ rows: [] as unknown[], total: 0 })),
}));
vi.mock("@/lib/actions/recommenders", () => actions);
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) =>
    createElement("header", null, createElement("h1", null, title), actions),
}));
vi.mock("@/components/recommenders/recommender-form-dialog", () => ({
  RecommenderFormDialog: () => createElement("button", { "data-add": "" }, "Add recommender"),
}));
vi.mock("@/app/(catalogue)/recommenders/recommenders-filters-bar", () => ({
  RecommendersFiltersBar: () => createElement("div", { "data-toolbar": "" }),
}));
vi.mock("@/app/(catalogue)/recommenders/recommenders-shell", () => ({ RecommendersShell: () => null }));

import RecommendersPage from "@/app/(catalogue)/recommenders/page";

const render = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup((await RecommendersPage({ searchParams: Promise.resolve(params) })) as ReactElement);
const adds = (html: string) => html.split("data-add").length - 1;

describe("/recommenders", () => {
  it("with none, shows one empty state that says what a recommender is, with one Add and no toolbar", async () => {
    actions.hasRecommenders.mockResolvedValueOnce(false);
    const html = await render();
    expect(html).toContain("No recommenders yet");
    expect(html).toContain("A recommender is whoever suggested a book to you");
    expect(html).toMatch(/<h2[^>]*>No recommenders yet<\/h2>/);
    expect(adds(html)).toBe(1);
    expect(html).not.toContain("data-toolbar");
    expect(actions.getRecommenderList).not.toHaveBeenCalled();
  });

  it("with none, a search in the address still shows the one empty state", async () => {
    actions.hasRecommenders.mockResolvedValueOnce(false);
    const html = await render({ q: "anyone" });
    expect(html).toContain("No recommenders yet");
    expect(html).not.toContain("data-toolbar");
  });

  it("with some, keeps the toolbar and the header's Add, and streams the list", async () => {
    actions.hasRecommenders.mockResolvedValueOnce(true);
    const page = (await RecommendersPage({ searchParams: Promise.resolve({}) })) as ReactElement<{ children: ReactNode }>;
    const html = renderToStaticMarkup(createElement("div", null, ([] as ReactNode[]).concat(page.props.children).filter((n) => !(isValidElement(n) && n.type === Suspense))));
    expect(html).toContain("data-toolbar");
    expect(adds(html)).toBe(1);
    expect(html).not.toContain("No recommenders yet");
    expect(([] as ReactNode[]).concat(page.props.children).some((n) => isValidElement(n) && n.type === Suspense)).toBe(true);
  });
});
