// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Design polish, 15 Oct: a list that fits on one page showed "Previous 1 / 1
// Next" above it, and "First Previous 1 Next Last", the count and "Go to page
// 1 Go" again below it (Books, a person, collections, series, eBooks).

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(),
}));

import { Pagination } from "@/components/shared/pagination";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props: Partial<Parameters<typeof Pagination>[0]>) {
  act(() => root.render(createElement(Pagination, { page: 1, perPage: 48, total: 9, noun: "books", ...props })));
  return {
    text: host.textContent ?? "",
    links: [...host.querySelectorAll("a, button")].map((el) => el.getAttribute("aria-label") ?? el.textContent),
    size: host.querySelector("select"),
  };
}

describe("Pagination with one page", () => {
  it("keeps the count above the list, with no page controls", () => {
    const above = render({ compact: true });
    expect(above.text).toContain("1–9 of 9");
    expect(above.links).toEqual([]);
    expect(above.text).not.toContain("1 / 1");
  });

  it("repeats nothing below the list", () => {
    render({});
    expect(host.innerHTML).toBe("");
  });

  it("offers the size only when a smaller page would split the list", () => {
    expect(render({ compact: true, total: 9 }).size).toBeNull();
    expect(render({ compact: true, total: 25 }).size).not.toBeNull();
  });

  // Above the list a phone hides the size, and the journal, notes and
  // highlights page with this pager alone: a size of 96 chosen for 55 items
  // could not be changed back (review of #350)
  it("keeps the size alone below the list while a smaller page would split it", () => {
    const below = render({ perPage: 96, total: 55 });
    expect(below.size).not.toBeNull();
    expect(below.links).toEqual([]);
    expect(below.text).not.toContain("of 55");
  });

  it("keeps the list's action", () => {
    const above = render({ compact: true, action: createElement("button", { type: "button" }, "Select") });
    expect(above.links).toEqual(["Select"]);
  });
});

describe("Pagination with more pages", () => {
  it("shows the arrows, the pages and Go to page as before", () => {
    const below = render({ total: 120 });
    expect(below.links).toEqual(expect.arrayContaining(["First", "Previous", "Page 1", "Page 2", "Page 3", "Next", "Last", "Go"]));
    expect(below.text).toContain("Go to page");
    expect(below.size).not.toBeNull();
  });
});
