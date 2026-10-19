// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LibraryFilters } from "@/app/(catalogue)/library/filters";
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
// Books has eight sorts: a menu and a direction arrow at every width (SLN-1025)
const pick = (value: string) => act(() => {
  const menu = host.querySelector<HTMLSelectElement>('select[aria-label="Sort by"]')!;
  menu.value = value;
  menu.dispatchEvent(new Event("change", { bubbles: true }));
});
const reverse = () => act(() => host.querySelector<HTMLButtonElement>('button[aria-label$="reverse the order"]')!.click());

describe("books sort controls", () => {
  it("saves a newly selected field and its default direction, resetting the page", () => {
    navigation.query = "holding=owned&page=3";
    render();
    pick("recent");
    expect(preference()).toEqual({ sort: "recent", order: "desc" });
    expect(navigation.push).toHaveBeenCalledWith("/library?holding=owned&sort=recent&order=desc");
  });

  it("saves toggled directions, including returning to the default direction", () => {
    navigation.query = "sort=recent&order=desc";
    render();
    reverse();
    expect(preference()).toEqual({ sort: "recent", order: "asc" });
    navigation.query = "sort=recent&order=asc";
    render();
    reverse();
    expect(preference()).toEqual({ sort: "recent", order: "desc" });
  });

  it("keeps an explicit Title selection when replacing a saved sort", () => {
    navigation.query = "sort=year&order=desc";
    render();
    pick("title");
    expect(preference()).toEqual({ sort: "title", order: "asc" });
    expect(navigation.push).toHaveBeenCalledWith("/library?sort=title&order=asc");
  });

  it("does not overwrite a choice on mount or when visiting a sort link", () => {
    document.cookie = `${LIBRARY_SORT_COOKIE}=${encodeURIComponent(JSON.stringify({ sort: "rating", order: "asc" }))}; Path=/`;
    navigation.query = "sort=title";
    render();
    expect(preference()).toEqual({ sort: "rating", order: "asc" });
  });

  it("on a phone, the menu picks a field and the arrow reverses it, as the chips do (SLN-639)", () => {
    navigation.query = "sort=year&order=desc";
    render();
    const menu = host.querySelector<HTMLSelectElement>('select[aria-label="Sort by"]')!;
    const arrow = host.querySelector<HTMLButtonElement>('button[aria-label$="reverse the order"]')!;
    expect(menu.value).toBe("year");
    expect(arrow.getAttribute("aria-label")).toBe("Descending, reverse the order");
    act(() => arrow.click());
    expect(preference()).toEqual({ sort: "year", order: "asc" });
    expect(navigation.push).toHaveBeenLastCalledWith("/library?sort=year&order=asc");
    act(() => {
      menu.value = "recent";
      menu.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(preference()).toEqual({ sort: "recent", order: "desc" });
    expect(navigation.push).toHaveBeenLastCalledWith("/library?sort=recent&order=desc");
  });

  it("offers Books' eight sorts as a menu, and a short list's as chips", () => {
    render();
    expect(host.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
    act(() => root.render(createElement(EntityFilters, {
      basePath: "/films", defaultSort: "title",
      sortOptions: ["title", "release", "runtime", "recent", "rating"].map((value) => ({ value, label: value })),
    })));
    expect(host.querySelectorAll("button[aria-pressed]")).toHaveLength(5);
    expect(host.querySelector('select[aria-label="Sort by"]')!.className).toContain("sm:hidden");
    // A phone held sideways gets the menu too, so its first screen holds records (SLN-1149)
    expect(host.querySelector('select[aria-label="Sort by"]')!.className).toContain("sideways:inline-block");
    for (const chip of host.querySelectorAll("button[aria-pressed]")) expect(chip.className).toContain("sideways:hidden");
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
