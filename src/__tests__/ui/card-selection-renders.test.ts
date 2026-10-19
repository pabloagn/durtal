// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-1249: selecting on /library redrew every card. A card now redraws only
// its frame for a tick, and only the parts the mode moves when selection
// starts or ends; its text, info and menu are drawn once.

const counts = vi.hoisted(() => ({ info: 0, menuRenders: 0, menuMounts: 0 }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/library" }));
vi.mock("@/components/shared/work-card", async (load) => {
  const real = await load<typeof import("@/components/shared/work-card")>();
  return {
    ...real,
    WorkCardInfo: (props: Parameters<typeof real.WorkCardInfo>[0]) => {
      counts.info++;
      return real.WorkCardInfo(props);
    },
  };
});
vi.mock("@/components/books/book-card-actions-menu", async () => {
  const { useEffect } = await import("react");
  return {
    BookCardActionsMenu: () => {
      counts.menuRenders++;
      useEffect(() => { counts.menuMounts++; }, []);
      return createElement("button", { "aria-label": "Actions" });
    },
  };
});

import { BookGrid } from "@/components/books/book-grid";

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

const books = Array.from({ length: 192 }, (_, i) => ({
  workId: `w${i}`,
  slug: `book-${i}`,
  title: `Book ${i}`,
  authorName: "A. Writer",
  authorNames: ["A. Writer"],
  instanceCount: 1,
  catalogueStatus: "accessioned",
  acquisitionPriority: "none",
  rating: 4,
  ebook: null,
}));
const onSelect = () => {};
const draw = (isSelecting: boolean, selected: string[] = []) =>
  act(() => root.render(createElement(BookGrid, { books, isSelecting, selectedIds: new Set(selected), onSelect })));
const reset = () => Object.assign(counts, { info: 0, menuRenders: 0, menuMounts: 0 });
const ticks = () => host.querySelectorAll("path[d='M2 6l3 3 5-5']").length;

describe("selecting book cards (SLN-1249)", () => {
  it("draws each card's text and menu once, whatever the selection does", () => {
    draw(false);
    expect(counts.info).toBe(192);
    expect(counts.menuMounts).toBe(192);

    reset();
    draw(true);
    expect(host.querySelectorAll(".artwork-actions[style*='none']").length).toBe(192);
    expect(counts).toEqual({ info: 0, menuRenders: 0, menuMounts: 0 });

    draw(true, ["w3"]);
    expect(ticks()).toBe(1);
    draw(true, books.map((b) => b.workId));
    expect(ticks()).toBe(192);
    expect(counts).toEqual({ info: 0, menuRenders: 0, menuMounts: 0 });

    // Leaving selection shows the menus again without mounting them
    draw(false);
    expect(ticks()).toBe(0);
    expect(host.querySelectorAll(".artwork-actions[style*='none']").length).toBe(0);
    expect(counts).toEqual({ info: 0, menuRenders: 0, menuMounts: 0 });
  });

  it("rings only the card a tick changes", () => {
    draw(true);
    reset();
    draw(true, ["w7"]);
    expect(counts.info).toBe(0);
    const ringed = host.querySelectorAll("[data-focus-row].ring-2");
    expect(ringed.length).toBe(1);
    expect(ringed[0].textContent).toContain("Book 7");
  });
});
