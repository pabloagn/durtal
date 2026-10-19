// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { QuickSearchResult } from "@/lib/actions/quick-search";

// SLN-965: a book's option held its Read link, so a screen reader read the
// link with every option; and the selected first result was not announced
// until an arrow key moved the selection.

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/quick-search", () => ({ quickSearch: mocks.search, getPaletteContinueReading: async () => null }));
vi.mock("@/lib/actions/reading", () => ({ getOpenReadings: async () => [] }));
vi.mock("@/components/shortcuts/shortcuts-provider", () => ({
  useShortcutActions: () => ({ editItems: () => [], readingItems: () => [], copyItems: () => [], itemKeys: () => [] }),
}));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({}) }));
vi.mock("@/components/reading/timer-provider", () => ({ useOptionalTimer: () => null }));
vi.mock("@/components/reading/timer-chip", () => ({ useStopTimer: () => () => {} }));

import { CommandPalette } from "@/components/layout/command-palette";

const ebook = {
  id: "11111111-1111-1111-1111-111111111111", title: "Watt", formats: ["epub"] as const, readable: true,
  readerPath: "/reader/11111111-1111-1111-1111-111111111111?file=22222222-2222-2222-2222-222222222222",
};
const work = (id: string, title: string, withEbook = false) => ({
  id, kind: "book" as const, title, href: `/library/${id}`, year: 1953, creators: ["Samuel Beckett"], cover: null,
  ebook: withEbook ? ebook : null,
});
const result: QuickSearchResult = {
  works: [work("watt", "Watt", true), work("murphy", "Murphy")],
  people: [], organizations: [], venues: [],
};

let host: HTMLElement, root: Root;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  mocks.search.mockReset();
  mocks.search.mockResolvedValue(result);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function open() {
  await act(async () => {
    root.render(createElement(CommandPalette, { open: true, onOpenChange: () => {} }));
  });
}
async function type(text: string) {
  const input = host.querySelector<HTMLInputElement>("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
  // The observer's records arrive after the render
  await act(async () => { await Promise.resolve(); });
  return input;
}
// An option's text starts with its cover's letter, then the title
const option = (title: string) =>
  [...host.querySelectorAll<HTMLElement>("[cmdk-item]")].find((item) => item.textContent?.slice(1).startsWith(title))!;
const selectedOption = () => host.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]')!;

describe("a book's option in the palette", () => {
  it("hides its Read link from a screen reader and keeps it out of Tab", async () => {
    await open(); await type("watt");
    const link = option("Watt").querySelector<HTMLElement>("a[data-reader-entry]")!;
    expect(link.getAttribute("aria-hidden")).toBe("true");
    expect(link.tabIndex).toBe(-1);
    expect(option("Watt").querySelector('a:not([aria-hidden="true"]), button')).toBeNull();
  });

  it("tells the keys that read it in its description", async () => {
    await open(); await type("watt");
    const ids = option("Watt").getAttribute("aria-describedby")!;
    expect(document.getElementById(ids)?.textContent).toMatch(/^(Command|Control) Enter to read$/);
    expect(document.getElementById(ids)?.hidden).toBe(true);
    // A book with no e-book to read has no such description
    expect(option("Murphy").hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("the palette's selected option", () => {
  it("is named to a screen reader as soon as the results show", async () => {
    await open();
    const input = await type("watt");
    expect(selectedOption()).toBe(option("Watt"));
    expect(input.getAttribute("aria-activedescendant")).toBe(option("Watt").id);
  });

  it("follows the arrows, and the next results", async () => {
    await open();
    const input = await type("watt");
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
    await act(async () => { await Promise.resolve(); });
    expect(input.getAttribute("aria-activedescendant")).toBe(option("Murphy").id);
    mocks.search.mockResolvedValue({ ...result, works: [work("molloy", "Molloy"), work("murphy", "Murphy")] });
    await type("mo");
    expect(selectedOption()).toBe(option("Molloy"));
    expect(input.getAttribute("aria-activedescendant")).toBe(option("Molloy").id);
  });
});
