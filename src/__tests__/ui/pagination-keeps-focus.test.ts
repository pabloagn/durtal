// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Focus survey, cause 1: each list route keys its Suspense by the page, so a
// new page remounts both pagers and the focused link went with them. The new
// pager gives the focus back to the control used, in the same pager.

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) =>
    createElement("a", { ...props, onClick: (event: Event) => { event.preventDefault(); (props.onClick as (() => void) | undefined)?.(); } }, children as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(),
}));

import { PaginatedSection } from "@/components/shared/pagination";

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

/** A list page as the routes render it: a new page is a new tree */
const show = (page: number) =>
  act(() =>
    root.render(createElement(PaginatedSection, { key: page, page, perPage: 10, total: 30, noun: "books", children: createElement("ul") })),
  );
const pagers = () => [...host.querySelectorAll("nav")];
const control = (nav: Element, name: string) => nav.querySelector<HTMLElement>(`[data-pager-control="${name}"]`)!;

describe("paging keeps the focus", () => {
  it("on the same control of the same pager", () => {
    show(1);
    const next = control(pagers()[1], "next");
    next.focus();
    act(() => next.click());
    show(2);
    expect(document.activeElement).toBe(control(pagers()[1], "next"));
  });

  it("on a page number", () => {
    show(1);
    const three = control(pagers()[1], "page-3");
    three.focus();
    act(() => three.click());
    show(3);
    expect(document.activeElement).toBe(control(pagers()[1], "page-3"));
  });

  it("on Previous when Next is gone, on the last page", () => {
    show(2);
    const next = control(pagers()[0], "next");
    next.focus();
    act(() => next.click());
    show(3);
    expect(document.activeElement).toBe(control(pagers()[0], "previous"));
  });
});
