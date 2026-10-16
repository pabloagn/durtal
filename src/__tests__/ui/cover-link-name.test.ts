// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Review of #408: a blank cover shows the title's first letter or digit, and
// none for a title with neither ("!!!"), which left the cover's link with no
// name. The link is named by the title.

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/library" }));

import { BookCard } from "@/components/books/book-card";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
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

it.each(["!!!", "«Quoted»", "1984"])("names a blank cover's link by its title: %s", (title) => {
  act(() => root.render(createElement(BookCard, { workId: "w1", slug: "w1", title, authorName: "A. Writer", instanceCount: 0, catalogueStatus: "tracked", acquisitionPriority: "none", rating: null, ebook: null })));
  const cover = host.querySelector<HTMLAnchorElement>('a[href="/library/w1"]')!;
  expect(cover.getAttribute("aria-label") || cover.textContent?.trim()).toBe(title);
});
