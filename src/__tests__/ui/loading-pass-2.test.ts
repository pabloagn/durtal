// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));
const navigation = vi.hoisted(() => ({ pathname: "/reading" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import ReadingLoading from "../../app/(catalogue)/reading/(tabs)/loading";
import CollectionLoading from "../../app/(catalogue)/collections/[id]/loading";
import SeriesLoading from "../../app/(catalogue)/series/[id]/loading";
import YearInReviewLoading from "../../app/(catalogue)/reading/year/[year]/loading";
import ImportPreviewLoading from "../../app/(catalogue)/reading/import/[id]/loading";
import RecommenderLoading from "../../app/(catalogue)/recommenders/[id]/loading";

// Second loading audit, 15 Oct (SLN-749, SLN-751): a click on a reading tab,
// a collection or a series showed nothing until the page arrived
function status(element: React.ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host.querySelector("[role=status]")!;
}

describe("the reading tabs' loading screen", () => {
  it.each([
    ["/reading", "Reading", ["Log a past read", "Start a book", "Goals"]],
    ["/reading/next", "Reading", ["Log a past read", "Start a book"]],
    ["/reading/notes", "Reading", ["Add a quote"]],
    ["/reading/stats", "Reading", ["Set a reading goal", "Year in review"]],
    ["/reading/year", "Year in review", []],
  ])("on %s draws the title %s, the tabs and the page's buttons, held", (pathname, title, buttons) => {
    navigation.pathname = pathname;
    const screen = status(createElement(ReadingLoading));
    expect(screen.getAttribute("aria-label")).toBe(title === "Reading" ? "Loading reading" : "Loading the years in review");
    expect(screen.querySelector("h1")!.textContent).toBe(title);
    expect(screen.querySelector("a[aria-current=page]")).not.toBeNull();
    const held = [...screen.querySelectorAll("span[aria-hidden=true].action-control")];
    expect(held.map((b) => b.textContent)).toEqual(buttons);
    // Held, not live: nothing to press while the page loads
    expect(screen.querySelector("button")).toBeNull();
  });
});

describe("a year in review's and an import's loading screens (SLN-815)", () => {
  it.each([
    ["/reading/year/2019", YearInReviewLoading, "Loading the year in review", "2019 in review", ["Print", "Stats for 2019"]],
    ["/reading/import/7d9b6a52-6f0e-4a8c-9d65-2f1b1d0c8e11", ImportPreviewLoading, "Loading the import", "Reading", ["Log a past read", "Start a book"]],
  ] as const)("on %s draws its header and buttons, held", (pathname, Loading, label, title, buttons) => {
    navigation.pathname = pathname;
    const screen = status(createElement(Loading));
    expect(screen.getAttribute("aria-label")).toBe(label);
    expect(screen.querySelector("h1")!.textContent).toBe(title);
    expect([...screen.querySelectorAll("span[aria-hidden=true].action-control")].map((b) => b.textContent)).toEqual(buttons);
    expect(screen.querySelector("button")).toBeNull();
  });
});

describe("a collection's, a series' and a recommender's loading screens", () => {
  it.each([
    ["a collection", CollectionLoading, "Loading the collection", "/collections"],
    ["a series", SeriesLoading, "Loading the series", "/series"],
    // SLN-817: a click on a recommender showed nothing until the page arrived
    ["a recommender", RecommenderLoading, "Loading the recommender", "/recommenders"],
  ] as const)("%s says it is loading and keeps the way back", (_, Loading, label, back) => {
    const screen = status(createElement(Loading));
    expect(screen.getAttribute("aria-label")).toBe(label);
    expect(screen.querySelector("a")!.getAttribute("href")).toBe(back);
  });

  it("draws a recommender's books in the page's own compact grid", () => {
    const grid = status(createElement(RecommenderLoading)).querySelector(".catalogue-grid");
    expect(grid?.classList.contains("catalogue-density-compact")).toBe(true);
    expect(grid?.parentElement?.classList.contains("@container")).toBe(true);
  });
});
