// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LibraryFilters } from "@/app/library/filters";
import { EntityFilters } from "@/components/shared/entity-filters";
import { LIBRARY_SORT_COOKIE, parseLibrarySortPreference } from "@/lib/library/sort-preference";
import { readCookie } from "@/lib/utils/preference-cookies";

const navigation = vi.hoisted(() => ({ query: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("@/lib/actions/library-filters", () => ({ getLibraryFilterOptions: vi.fn() }));

let root: Root;
let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  navigation.query = "";
  navigation.push.mockReset();
  document.cookie = `${LIBRARY_SORT_COOKIE}=; Max-Age=0; Path=/`;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(() => root.render(createElement(LibraryFilters)));
const click = (label: string) => act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click());
const preference = () => parseLibrarySortPreference(readCookie(LIBRARY_SORT_COOKIE));

describe("books sort controls", () => {
  it("saves a newly selected field and its default direction, resetting the page", () => {
    navigation.query = "holding=owned&page=3";
    render();
    click("Recent");
    expect(preference()).toEqual({ sort: "recent", order: "desc" });
    expect(navigation.push).toHaveBeenCalledWith("/library?holding=owned&sort=recent&order=desc");
  });

  it("saves toggled directions, including returning to the default direction", () => {
    navigation.query = "sort=recent&order=desc";
    render();
    click("Recent");
    expect(preference()).toEqual({ sort: "recent", order: "asc" });
    navigation.query = "sort=recent&order=asc";
    render();
    click("Recent");
    expect(preference()).toEqual({ sort: "recent", order: "desc" });
  });

  it("keeps an explicit Title selection when replacing a saved sort", () => {
    navigation.query = "sort=year&order=desc";
    render();
    click("Title");
    expect(preference()).toEqual({ sort: "title", order: "asc" });
    expect(navigation.push).toHaveBeenCalledWith("/library?sort=title&order=asc");
  });

  it("does not overwrite a choice on mount or when visiting a sort link", () => {
    document.cookie = `${LIBRARY_SORT_COOKIE}=${encodeURIComponent(JSON.stringify({ sort: "rating", order: "asc" }))}; Path=/`;
    navigation.query = "sort=title";
    render();
    expect(preference()).toEqual({ sort: "rating", order: "asc" });
  });

  it("preserves the existing URL behaviour for other lists", () => {
    act(() => root.render(createElement(EntityFilters, {
      basePath: "/people", defaultSort: "name", sortOptions: [{ value: "name", label: "Name" }],
    })));
    click("Name");
    expect(navigation.push).toHaveBeenCalledWith("/people?order=desc");
    expect(preference()).toBeUndefined();
  });
});
