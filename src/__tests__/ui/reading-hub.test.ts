// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The reading hub's client pieces (SLN-448): the book picker, the add-a-book
// page's query, the book page's `then`, and the dialogs in both shell branches.

const actions = vi.hoisted(() => ({
  searchBooksToRead: vi.fn(async (_q: string) => [] as unknown[]),
  getReadingDialogData: vi.fn(),
  pauseReading: vi.fn(),
  resumeReading: vi.fn(),
  reopenReading: vi.fn(),
}));
const nav = vi.hoisted(() => ({ pathname: "/reading", replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
const dialogs = vi.hoisted(() => ({ open: vi.fn(async () => {}), pick: vi.fn(), setPaused: vi.fn(), real: false }));

vi.mock("@/lib/actions/reading", () => actions);
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: nav.refresh, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }), Toaster: () => null }));
// The shell's heavy neighbours: only the reading dialogs are under test
vi.mock("@/components/layout/sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/layout/mobile-nav-bar", () => ({ MobileNavBar: () => null }));
vi.mock("@/components/layout/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/shortcuts/shortcuts-provider", () => ({
  ShortcutsProvider: ({ children }: { children: unknown }) => children,
  useReadingActions: () => {},
}));
vi.mock("@/components/reading/reading-dialogs-provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/reading/reading-dialogs-provider")>();
  return {
    ...real,
    useReadingDialogs: () => (dialogs.real ? real.useReadingDialogs() : dialogs),
  };
});

import { BookPicker } from "@/components/reading/book-picker";
import { ReadingThen } from "@/components/reading/reading-then";
import { Shell } from "@/components/layout/shell";
import { useReadingDialogs } from "@/components/reading/reading-dialogs-provider";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute("open", "");
  };
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  dialogs.real = false;
  [...Object.values(actions), dialogs.open, dialogs.pick, nav.replace].forEach((fn) => fn.mockClear());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const settle = (ms = 260) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const body = () => document.body;
const search = () => body().querySelector('input[aria-label="Search books"]') as HTMLInputElement;
const addLinks = () => [...body().querySelectorAll("[data-picker-add]")].map((a) => a.getAttribute("href"));

describe("the book picker", () => {
  it("offers to add a book that is not in Durtal, in the empty result and the footer", async () => {
    act(() => root.render(createElement(BookPicker, { purpose: "start", onClose: () => {} })));
    await settle();
    type(search(), "Dune");
    await settle();
    expect(actions.searchBooksToRead).toHaveBeenLastCalledWith("Dune");
    expect(body().querySelector("[data-picker-empty]")?.textContent).toContain('Not in Durtal? Add “Dune”');
    expect(addLinks()).toEqual(["/library/new?q=Dune&then=start"]);

    actions.searchBooksToRead.mockResolvedValueOnce([
      { id: "w1", title: "Dune Messiah", slug: "dune-messiah", author: "Frank Herbert", cover: null, owned: true, catalogueStatus: "accessioned", state: "unread", reads: 0, percent: null, openReadingId: null, openFingerprint: null },
    ]);
    type(search(), "Dune M");
    await settle();
    expect(body().querySelector("[data-picker-results]")?.textContent).toContain("Frank Herbert · Owned");
    expect(addLinks()).toEqual(["/library/new?q=Dune+M&then=start"]);
  });

  it("sends an ISBN as an ISBN, and a past read as then=past", async () => {
    act(() => root.render(createElement(BookPicker, { purpose: "past", onClose: () => {} })));
    await settle();
    type(search(), "978-0-14-118776-1");
    await settle();
    expect(addLinks()).toEqual(["/library/new?isbn=9780141187761&then=past"]);
  });

  it("opens Log progress, with the reading's fingerprint, for a book already being read", async () => {
    actions.searchBooksToRead.mockResolvedValue([
      { id: "w2", title: "Watt", slug: "watt", author: "Samuel Beckett", cover: null, owned: true, catalogueStatus: "accessioned", state: "reading", reads: 1, percent: 44, openReadingId: "r2", openFingerprint: "fp2" },
    ]);
    const closed = vi.fn();
    act(() => root.render(createElement(BookPicker, { purpose: "start", onClose: closed })));
    await settle();
    expect(body().textContent).toContain("Reading 44%");
    act(() => (body().querySelector("[data-picker-results] button") as HTMLButtonElement).click());
    expect(closed).toHaveBeenCalled();
    expect(dialogs.open).toHaveBeenCalledWith({ kind: "progress", workId: "w2", readingId: "r2", fingerprint: "fp2" });
    actions.searchBooksToRead.mockResolvedValue([]);
  });
});

describe("a book page opened with ?then=", () => {
  it("opens the dialog once and takes then out of the address", async () => {
    window.history.replaceState(null, "", "/library/watt?tab=1&then=start#reading");
    const props = { workId: "w1", then: "start" as const, openReading: null };
    act(() => root.render(createElement(ReadingThen, props)));
    act(() => root.render(createElement(ReadingThen, { ...props })));
    expect(dialogs.open).toHaveBeenCalledTimes(1);
    expect(dialogs.open).toHaveBeenCalledWith({ kind: "start", workId: "w1" });
    expect(nav.replace).toHaveBeenCalledWith("/library/watt?tab=1#reading", { scroll: false });
  });

  it("logs progress instead of starting a book that is being read, and opens Log a past read for then=past", () => {
    window.history.replaceState(null, "", "/library/watt?then=start");
    const reading = { workId: "w1", readingId: "r1", fingerprint: "fp1" };
    act(() => root.render(createElement(ReadingThen, { workId: "w1", then: "start", openReading: reading })));
    expect(dialogs.open).toHaveBeenCalledWith({ kind: "progress", ...reading });
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(createElement(ReadingThen, { workId: "w1", then: "past", openReading: reading })));
    expect(dialogs.open).toHaveBeenLastCalledWith({ kind: "past", workId: "w1" });
  });
});

describe("the shell", () => {
  function Child() {
    const value = useReadingDialogs();
    return createElement("p", { "data-has-dialogs": String(typeof value.open === "function" && typeof value.pick === "function") });
  }
  it.each(["/reader/12", "/library"])("gives %s the reading dialogs", (path) => {
    dialogs.real = true;
    nav.pathname = path;
    act(() => root.render(createElement(Shell, null, createElement(Child))));
    expect(host.querySelector("[data-has-dialogs]")?.getAttribute("data-has-dialogs")).toBe("true");
    nav.pathname = "/reading";
  });
});
