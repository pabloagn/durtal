// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { QuickSearchResult } from "@/lib/actions/quick-search";

// SLN-966: the palette lists series, collections, recommenders and taxonomy
// items in their own groups, each opening its page.

const mocks = vi.hoisted(() => ({ search: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/actions/quick-search", () => ({ quickSearch: mocks.search, getPaletteContinueReading: async () => null }));
vi.mock("@/lib/actions/reading", () => ({ getOpenReadings: async () => [] }));
vi.mock("@/components/shortcuts/shortcuts-provider", () => ({
  useShortcutActions: () => ({ editItems: () => [], readingItems: () => [], copyItems: () => [], itemKeys: () => [] }),
}));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({}) }));
vi.mock("@/components/reading/timer-provider", () => ({ useOptionalTimer: () => null }));
vi.mock("@/components/reading/timer-chip", () => ({ useStopTimer: () => () => {} }));

import { CommandPalette } from "@/components/layout/command-palette";

const result: QuickSearchResult = {
  works: [], people: [], organizations: [], venues: [],
  series: [{ id: "s1", name: "Les Rougon-Macquart", href: "/series/s1" }],
  collections: [{ id: "c1", name: "Décadents", href: "/collections/c1" }],
  recommenders: [{ id: "r1", name: "Gaston Bachelard", href: "/recommenders/r1" }],
  taxonomy: [{ id: "t1", name: "Occultisme", href: "/taxonomy/subjects/occultisme", detail: "Subjects" }],
};

let host: HTMLElement, root: Root;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  mocks.search.mockReset();
  mocks.push.mockReset();
  mocks.search.mockResolvedValue(result);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function search(text: string) {
  await act(async () => {
    root.render(createElement(CommandPalette, { open: true, onOpenChange: () => {} }));
  });
  const input = host.querySelector<HTMLInputElement>("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
}
const group = (heading: string) =>
  [...host.querySelectorAll<HTMLElement>("[cmdk-group]")].find((g) => g.querySelector("[cmdk-group-heading]")?.textContent === heading);

describe("the palette's record groups", () => {
  it("lists each kind under its own heading", async () => {
    await search("rougon");
    expect(group("Series")?.querySelector("[cmdk-item]")?.textContent).toBe("Les Rougon-Macquart");
    expect(group("Collections")?.querySelector("[cmdk-item]")?.textContent).toBe("Décadents");
    expect(group("Recommenders")?.querySelector("[cmdk-item]")?.textContent).toBe("Gaston Bachelard");
    // A taxonomy item says which family it is in
    expect(group("Taxonomy")?.querySelector("[cmdk-item]")?.textContent).toBe("Occultisme · Subjects");
  });

  it("uses the same whole initials as the person cards", async () => {
    mocks.search.mockResolvedValue({ ...result, people: [
      { id: "hindi", name: "प्रेमचंद", href: "/people/hindi", photo: null, roles: "Author" },
      { id: "supplementary", name: "𠮷", href: "/people/supplementary", photo: null, roles: "Author" },
      { id: "accent", name: "E\u0301mile Zola", href: "/people/accent", photo: null, roles: "Author" },
    ] });
    await search("author");
    const initials = [...group("People")!.querySelectorAll('[aria-hidden="true"]')]
      .map((e) => e.textContent).filter(Boolean);
    expect(initials).toEqual(expect.arrayContaining(["प्रे", "𠮷", "ÉZ"]));
  });

  it("selects the first record when nothing comes before it, and opens its page", async () => {
    await search("rougon");
    const first = group("Series")!.querySelector<HTMLElement>("[cmdk-item]")!;
    expect(first.getAttribute("aria-selected")).toBe("true");
    await act(async () => { group("Taxonomy")!.querySelector<HTMLElement>("[cmdk-item]")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mocks.push).toHaveBeenCalledWith("/taxonomy/subjects/occultisme");
  });
});
