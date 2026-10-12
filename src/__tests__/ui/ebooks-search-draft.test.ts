// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";

const route = vi.hoisted(() => ({ query: "q=Seed+Library+Book&perPage=48&page=3", replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: route.replace, push: route.push }), useSearchParams: () => new URLSearchParams(route.query) }));
vi.mock("@/components/shared/filter-dropdown", () => ({ FilterDropdown: () => null }));
vi.mock("@/components/books/view-mode-switcher", () => ({ ViewModeSwitcher: () => null }));
vi.mock("@/components/books/grid-size-slider", () => ({ GridSizeSlider: () => null }));
import { EbooksFilters } from "../../app/(catalogue)/ebooks/ebooks-filters";

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root, host: HTMLElement;
const counts = { total: 5999, active: 5999, excluded: 1, review: 3199, formats: ["epub"], languages: ["en"] };
const render = () => act(() => root.render(createElement(Fragment, null,
  createElement("button", { id: "clear", onClick: () => { route.query = "perPage=48"; render(); } }, "Clear search and filters"),
  createElement(EbooksFilters, { counts, view: "grid", setView: () => {}, columns: 4, setColumns: () => {} }))));
const input = () => host.querySelector('input[aria-label="Search eBooks"]') as HTMLInputElement;
function type(value: string) {
  act(() => {
    input().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
function commit(href: string) { route.query = new URL(href, "http://127.0.0.1:3410").search.slice(1); render(); }
function search(value: string) { type(value); advance(150); const href = route.replace.mock.lastCall?.[0]; expect(typeof href).toBe("string"); commit(href as string); }
beforeEach(() => { vi.useFakeTimers(); route.query = "q=Seed+Library+Book&perPage=48&page=3"; route.replace.mockReset(); route.push.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); render(); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("eBook search draft", () => {
  it("searches the original query again after the empty search is cleared", () => {
    search("Seed Library Author"); search("SLN495 absence sentinel");
    act(() => { const clear = host.querySelector("#clear") as HTMLButtonElement; clear.focus(); clear.click(); });
    expect(input().value).toBe(""); route.replace.mockClear();
    type("Seed Library Book"); expect(input().value).toBe("Seed Library Book"); advance(149); expect(route.replace).not.toHaveBeenCalled(); advance(1);
    expect(route.replace).toHaveBeenCalledOnce();
    const url = new URL(route.replace.mock.lastCall![0], "http://127.0.0.1:3410");
    expect(url.searchParams.get("q")).toBe("Seed Library Book"); expect(url.searchParams.get("perPage")).toBe("48"); expect(url.searchParams.has("page")).toBe(false);
  });
  it("keeps presentation and filters while resetting the page for a new query", () => {
    route.query = "q=old&perPage=48&page=3&sort=author&order=desc&linked=linked&format=epub&language=en"; render();
    type("new query"); advance(150); const url = new URL(route.replace.mock.lastCall![0], "http://127.0.0.1:3410");
    expect(url.searchParams.get("q")).toBe("new query"); expect(url.searchParams.has("page")).toBe(false);
    for (const [key,value] of [["perPage","48"],["sort","author"],["order","desc"],["linked","linked"],["format","epub"],["language","en"]]) expect(url.searchParams.get(key)).toBe(value);
  });
  it("preserves a focused draft through a committed URL update", () => {
    type("still typing"); route.query = "q=committed&perPage=48"; render(); expect(input().value).toBe("still typing");
    advance(150); expect(new URL(route.replace.mock.lastCall![0], "http://127.0.0.1:3410").searchParams.get("q")).toBe("still typing");
  });
  it("updates an unfocused input from navigation without initiating a search", () => {
    input().blur(); route.query = "q=from+navigation&perPage=48"; render(); expect(input().value).toBe("from navigation"); advance(150); expect(route.replace).not.toHaveBeenCalled();
  });
  it("coalesces edits and cancels the pending debounce on unmount", () => {
    type("first"); advance(100); type("second"); advance(149); expect(route.replace).not.toHaveBeenCalled(); advance(1); expect(route.replace).toHaveBeenCalledOnce();
    route.replace.mockClear(); type("discarded"); act(() => root.unmount()); advance(150); expect(route.replace).not.toHaveBeenCalled();
    root = createRoot(host);
  });
});
