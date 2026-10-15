// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { QuickSearchResult } from "@/lib/actions/quick-search";

// A palette search that fails says so, with a way to run it again (SLN-752)
const mocks = vi.hoisted(() => ({ search: vi.fn(), close: vi.fn() }));
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

const found: QuickSearchResult = {
  works: [{ id: "book", kind: "book", title: "Against Nature", href: "/library/against-nature", year: 1884, creators: ["Joris-Karl Huysmans"], cover: null }],
  people: [], organizations: [], venues: [],
};
let host: HTMLElement, root: Root;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(async () => {
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => {
    root.render(createElement(CommandPalette, { open: true, onOpenChange: mocks.close, recentEbook: null }));
  });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
async function type(text: string) {
  const input = host.querySelector<HTMLInputElement>("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
const failure = () => host.querySelector("[data-palette-failed]");

describe("a palette search that fails", () => {
  it("says the catalogue could not be searched, and searches again on request", async () => {
    mocks.search.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValueOnce(found);
    await type("huys");
    expect(failure()!.querySelector("[role=status]")!.textContent).toBe("The catalogue could not be searched.");
    expect(host.textContent).not.toContain("Against Nature");

    const again = [...host.querySelectorAll("[cmdk-item]")].find((item) => item.textContent === "Search again")!;
    await act(async () => { (again as HTMLElement).click(); });
    await settle();
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(failure()).toBeNull();
    expect(host.textContent).toContain("Against Nature");
    expect(document.activeElement).toBe(host.querySelector("input"));
  });

  it("clears the failure when the search changes or is emptied", async () => {
    mocks.search.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue(found);
    await type("huys");
    expect(failure()).not.toBeNull();
    await type("h");
    expect(failure()).toBeNull();
    await type("huysmans");
    expect(failure()).toBeNull();
  });

  it("labels the spinner while it searches", async () => {
    mocks.search.mockReturnValue(new Promise(() => {}));
    await type("huys");
    expect(host.querySelector("[role=status]")!.textContent).toBe("Searching");
  });
});
