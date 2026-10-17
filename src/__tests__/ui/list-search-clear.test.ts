// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearListSearch } from "@/lib/ui/list-search";

const route = vi.hoisted(() => ({ query: "q=missing&format=epub&perPage=48&page=3", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: route.push, replace: route.replace }), useSearchParams: () => new URLSearchParams(route.query) }));
vi.mock("next/link", () => ({ default: ({ onClick, href, ...props }: { onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void; href: string }) =>
  h("a", { ...props, href, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) route.push(href);
    event.preventDefault();
  } }) }));
vi.mock("@/components/shared/filter-dropdown", () => ({ FilterDropdown: () => null }));
vi.mock("@/components/books/view-mode-switcher", () => ({ ViewModeSwitcher: () => null }));
vi.mock("@/components/books/grid-size-slider", () => ({ GridSizeSlider: () => null }));

import { EntityFilters } from "@/components/shared/entity-filters";
import { OrganizationFilters } from "@/components/organizations/organization-filters";
import { EbooksFilters } from "@/app/(catalogue)/ebooks/ebooks-filters";
import { NoResults } from "@/components/shared/no-results";

let root: Root, host: HTMLElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  route.query = "q=missing&format=epub&perPage=48&page=3";
  route.push.mockReset(); route.replace.mockReset();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as never);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const counts = { total: 2, active: 2, excluded: 0, review: 0, formats: ["epub"], languages: ["en"] };
function render(kind: string, onClear?: (event: React.MouseEvent<HTMLAnchorElement>) => void) {
  const filters = kind === "entity" ? h(EntityFilters, { basePath: "/library", sortOptions: [{ value: "title", label: "Title" }] })
    : kind === "organization" ? h(OrganizationFilters, { counts: { all: 2, roles: {} as never } })
    : h(EbooksFilters, { counts, view: "grid", setView: () => {}, columns: 4, setColumns: () => {} });
  act(() => root.render(h("main", null, h("h1", null, "List"), filters,
    h(NoResults, { noun: "items", search: "missing", hasFilters: true, clearHref: "/cleared?perPage=48", onClear }))));
}
const field = () => host.querySelector<HTMLInputElement>('[data-list-focus="search"]')!;
function type(value: string) {
  act(() => {
    field().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe.each(["entity", "organization", "ebook"])("%s list clear", kind => {
  it("focuses the empty field before navigation and cancels the pending draft", () => {
    render(kind); type("pending draft");
    act(() => host.querySelector<HTMLAnchorElement>('a[href^="/cleared"]')!.click());
    expect(field().value).toBe("");
    expect(document.activeElement).toBe(field());
    act(() => vi.advanceTimersByTime(500));
    expect(route.push).toHaveBeenCalledExactlyOnceWith("/cleared?perPage=48");
    expect(route.replace).not.toHaveBeenCalled();
    route.query = "perPage=48"; render(kind);
    expect(field().value).toBe("");
    expect(document.activeElement).toBe(field());
  });
  it("clears through the owner and navigates once without losing existing filters", () => {
    render(kind); type("pending draft");
    act(() => clearListSearch(field()));
    act(() => vi.advanceTimersByTime(500));
    const calls = [...route.push.mock.calls, ...route.replace.mock.calls];
    expect(calls).toHaveLength(1);
    const query = new URL(calls[0][0], "http://example.test").searchParams;
    expect(query.has("q")).toBe(false);
    expect(query.has("page")).toBe(false);
    expect(query.get("format")).toBe("epub");
    expect(query.get("perPage")).toBe("48");
    expect(field().value).toBe("");
    expect(document.activeElement).toBe(field());
  });
});

it("preserves a caller's in-place clear action", () => {
  const onClear = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
  render("entity", onClear);
  act(() => host.querySelector<HTMLAnchorElement>('a[href^="/cleared"]')!.click());
  expect(onClear).toHaveBeenCalledOnce();
  expect(field().value).toBe("");
  expect(document.activeElement).toBe(field());
  expect(route.push).not.toHaveBeenCalled();
});

it("does not clear the current field when opening the clear link with a modifier", () => {
  render("entity");
  const input = field();
  act(() => host.querySelector<HTMLAnchorElement>('a[href^="/cleared"]')!.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }),
  ));
  expect(input.value).toBe("missing");
});
