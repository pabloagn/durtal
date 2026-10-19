// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The card's reading in its status slot (SLN-449).

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/library" }));

import { BookCard } from "@/components/books/book-card";
import { CardReading } from "@/components/books/card-status";

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

const card = {
  workId: "w1",
  slug: "watt",
  title: "Watt",
  authorName: "Samuel Beckett",
  instanceCount: 2,
  catalogueStatus: "accessioned",
  acquisitionPriority: "high",
  rating: 4,
  ebook: null,
};
const ebook = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Watt",
  formats: ["epub"] as const,
  readable: true,
  readerPath: "/reader/11111111-1111-1111-1111-111111111111?file=22222222-2222-2222-2222-222222222222",
};

describe("CardReading", () => {
  it("replaces the status while a reading is open, and extends its tooltip", () => {
    act(() => root.render(createElement(BookCard, { ...card, reading: { state: "reading", percent: 44.17 } })));
    const slot = host.querySelector("[data-card-reading]") as HTMLElement;
    expect(slot.textContent).toBe("Reading 44%");
    expect(slot.getAttribute("data-tooltip")).toBe("Accessioned · High priority · 2 copies · Reading, 44%");
    expect(slot.querySelector(".bg-accent-blue")).not.toBeNull();
    expect(host.textContent).not.toContain("Accessioned");
  });

  it("reads Paused with a secondary dot, and Reading with no percent", () => {
    act(() => root.render(createElement(CardReading, { reading: { state: "paused", percent: 12.4 }, status: "wanted" })));
    expect(host.textContent).toBe("Paused 12%");
    expect(host.querySelector(".bg-fg-secondary")).not.toBeNull();
    expect(host.querySelector("[data-tooltip]")!.getAttribute("data-tooltip")).toBe("Wanted · Paused, 12%");
    act(() => root.render(createElement(CardReading, { reading: { state: "reading", percent: null }, status: "accessioned" })));
    expect(host.textContent).toBe("Reading");
  });

  it("leaves the status alone without a reading", () => {
    act(() => root.render(createElement(BookCard, card)));
    expect(host.querySelector("[data-card-reading]")).toBeNull();
    expect(host.textContent).toContain("Accessioned");
  });

  it("shows the eBook mark only for a readable e-book, without altering status", () => {
    act(() => root.render(createElement(BookCard, { ...card, ebook: null })));
    expect(host.querySelector('[aria-label="eBook available"]')).toBeNull();
    expect(host.textContent).toContain("Accessioned");
    act(() => root.render(createElement(BookCard, { ...card, ebook })));
    expect(host.querySelector('[aria-label="eBook available"]')).not.toBeNull();
    expect(host.textContent).toContain("Accessioned");
  });

  it("opens the actual card menu on a cover context click", async () => {
    act(() => root.render(createElement(BookCard, { ...card, ebook })));
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(async () => {
      host.querySelector<HTMLAnchorElement>('a[href="/library/watt"]')!.dispatchEvent(event);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(event.defaultPrevented).toBe(true);
    expect(host.querySelector('a[data-reader-entry]')).not.toBeNull();
  });

  it("keeps the card menu reader link's native default and origin destination", async () => {
    act(() => root.render(createElement(BookCard, { ...card, ebook, readerReturnTo: "/people/samuel-beckett?view=books" })));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Actions"]')!.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const link = host.querySelector<HTMLAnchorElement>('a[data-reader-entry]')!;
    const url = new URL(link.href);
    expect(url.searchParams.get("file")).toBe("22222222-2222-2222-2222-222222222222");
    expect(url.searchParams.get("returnTo")).toBe("/people/samuel-beckett?view=books");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => { link.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  });

  it("closes an open menu for selection and keeps it closed when selection ends", async () => {
    act(() => root.render(createElement(BookCard, { ...card, ebook })));
    await act(async () => {
      host.querySelector<HTMLAnchorElement>('a[href="/library/watt"]')!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(host.querySelector('a[data-reader-entry]')).not.toBeNull();
    act(() => root.render(createElement(BookCard, { ...card, ebook, isSelecting: true })));
    // The actions stay mounted but hidden, so leaving selection redraws no menu (SLN-1249)
    expect(host.querySelector<HTMLElement>(".artwork-actions")!.style.display).toBe("none");
    expect(host.querySelector('a[data-reader-entry]')).toBeNull();
    act(() => root.render(createElement(BookCard, { ...card, ebook, isSelecting: false })));
    expect(host.querySelector<HTMLElement>(".artwork-actions")!.style.display).toBe("");
    expect(host.querySelector('button[aria-label="Actions"]')).not.toBeNull();
    expect(host.querySelector('a[data-reader-entry]')).toBeNull();
    await act(async () => {
      host.querySelector<HTMLAnchorElement>('a[href="/library/watt"]')!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(host.querySelector('a[data-reader-entry]')).not.toBeNull();
  });
});
