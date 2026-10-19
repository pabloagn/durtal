// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { QuickSearchResult } from "@/lib/actions/quick-search";

const mocks = vi.hoisted(() => ({ search: vi.fn(), push: vi.fn(), close: vi.fn(), recent: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/actions/quick-search", () => ({ quickSearch: mocks.search, getPaletteContinueReading: mocks.recent }));
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
const result: QuickSearchResult = {
  works: [{ id: "book", kind: "book", title: "Watt", href: "/library/watt", year: 1953, creators: ["Samuel Beckett"], cover: null, ebook }],
  people: [], organizations: [], venues: [],
};
let host: HTMLElement, root: Root;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.search.mockResolvedValue(result);
  mocks.recent.mockResolvedValue(null);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function open(recentEbook: typeof ebook | null = null) {
  await act(async () => {
    root.render(createElement(CommandPalette, { open: true, onOpenChange: mocks.close, recentEbook, readerReturnTo: "/series/beckett" }));
  });
}
async function search() {
  const input = host.querySelector<HTMLInputElement>("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "watt");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
  return input;
}

describe("palette eBook adapters", () => {
  it("loads actual Continue metadata each time it opens without a supplied projection", async () => {
    mocks.recent.mockResolvedValue(ebook);
    await act(async () => {
      root.render(createElement(CommandPalette, { open: false, onOpenChange: mocks.close }));
    });
    expect(mocks.recent).not.toHaveBeenCalled();
    await act(async () => {
      root.render(createElement(CommandPalette, { open: true, onOpenChange: mocks.close }));
    });
    expect(mocks.recent).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Continue reading Watt");
    await act(async () => {
      root.render(createElement(CommandPalette, { open: false, onOpenChange: mocks.close }));
    });
    mocks.recent.mockResolvedValue(null);
    await act(async () => {
      root.render(createElement(CommandPalette, { open: true, onOpenChange: mocks.close }));
    });
    expect(mocks.recent).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Continue reading Watt");
  });

  it.each(["metaKey", "ctrlKey"])("opens the selected book's eligible file with %s+Enter using a document navigation", async (modifier) => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    await open(); const input = await search();
    expect(host.querySelector('a[data-reader-entry][aria-hidden="true"]')).not.toBeNull();
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", [modifier]: true, bubbles: true, cancelable: true })); });
    const href = assign.mock.calls[0]?.[0];
    expect(typeof href).toBe("string");
    const url = new URL(href as string, window.location.origin);
    expect(url.pathname).toBe(`/reader/${ebook.id}`);
    expect(url.searchParams.get("file")).toBe("22222222-2222-2222-2222-222222222222");
    expect(url.searchParams.get("returnTo")).toBe("/series/beckett");
    expect(mocks.close).toHaveBeenCalledWith(false);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps plain Enter on the book page and suppresses reader shortcuts during composition", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    await open(); const input = await search();
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, isComposing: true, bubbles: true })); });
    expect(assign).not.toHaveBeenCalled();
    // IME's Enter may be consumed by cmdk; start a fresh palette for the plain Enter contract.
    mocks.push.mockClear();
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(mocks.push).toHaveBeenCalledWith("/library/watt");
    expect(assign).not.toHaveBeenCalled();
  });

  it("does not attach secondary Read to other work kinds or unavailable metadata", async () => {
    mocks.search.mockResolvedValue({ ...result, works: [
      { ...result.works[0], ebook: { ...ebook, readable: false, readerPath: null } },
      { ...result.works[0], id: "film", kind: "film", href: "/films/watt" },
    ] });
    await open(); await search();
    expect(host.querySelector('a[data-reader-entry]')).toBeNull();
  });

  it("caps unlinked entries at five and omits linked or excluded duplicates", async () => {
    mocks.search.mockResolvedValue({ ...result, ebooks: [
      { ebook, matchState: "linked" }, { ebook, matchState: "excluded" },
      ...Array.from({ length: 7 }, (_, index) => ({ ebook: { ...ebook, id: `unlinked-${index}`, title: `Unlinked ${index}` }, matchState: "pending" })),
    ] });
    await open(); await search();
    const group = [...host.querySelectorAll('[cmdk-group]')].find((node) => node.textContent?.startsWith("eBooks"))!;
    expect(group.querySelectorAll('[cmdk-item]')).toHaveLength(5);
    act(() => { group.querySelector<HTMLElement>('[cmdk-item]')!.click(); });
    expect(mocks.push).toHaveBeenCalledWith("/ebooks/unlinked-0");
  });

  it("shows Continue only for an empty query and opens its eligible target", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    await open(ebook);
    const row = [...host.querySelectorAll<HTMLElement>('[cmdk-item]')].find((node) => node.textContent === "Continue reading Watt")!;
    expect(row).toBeTruthy();
    act(() => { row.click(); });
    expect(assign).toHaveBeenCalledOnce();
    await search();
    expect(host.textContent).not.toContain("Continue reading Watt");
  });
});
