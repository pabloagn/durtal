// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "@/components/reader/search-panel";
import type { ReaderEngine } from "@/lib/reader/engine";
import type {
  SearchHit,
  SearchRequest,
  SearchUpdate,
} from "@/lib/reader/search/types";

const hit: SearchHit = {
  id: "0:5:9",
  start: 5,
  end: 9,
  linear: true,
  inNote: false,
  sectionLabel: "Chapter one",
  locator: {
    v: 1,
    fileHash: "a".repeat(64),
    href: "one.xhtml",
    sectionIndex: 0,
    progression: 0.2,
    totalProgression: 0.2,
    position: 12,
    cfi: "epubcfi(/6/2!/4/2)",
  },
  excerpt: { before: "some ", match: "text", after: " after" },
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: !query.includes("max-width"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperties(HTMLDialogElement.prototype, {
    show: {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    },
    showModal: {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value() {
        this.removeAttribute("open");
      },
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("search panel delivery and keyboard ownership", () => {
  it("renders safe marked excerpts, jumps through its callback, and keeps the hits when the panel closes", async () => {
    const search = vi.fn(async function* (
      _request: SearchRequest,
    ): AsyncGenerator<SearchUpdate> {
      yield { kind: "hits", hits: [hit] };
      yield { kind: "complete", capped: false, count: 1 };
    });
    const decorations = vi.fn();
    const onJump = vi.fn(async () => true);
    const onClose = vi.fn();
    const engine = {
      search,
      currentLocator: () => null,
      setDecorations: decorations,
    } as unknown as ReaderEngine;
    await act(async () =>
      root.render(
        createElement(SearchPanel, {
          open: true,
          engine,
          language: "en",
          onJump,
          onClose,
          onOpen: vi.fn(),
        }),
      ),
    );
    const field = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    // React's controlled input observes the platform setter used by browser typing.
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, "text");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(search).toHaveBeenCalledTimes(1);
    expect(host.querySelector("mark")?.textContent).toBe("text");
    expect(host.textContent).toContain("Location 12");
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[data-hit]")!.click(),
    );
    expect(onJump).toHaveBeenCalledWith(hit.locator, hit);
    expect(host.querySelector("[aria-current=location]")).not.toBeNull();
    // The panel's Close only closes the panel: the hits stay marked (SLN-675)
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(decorations).not.toHaveBeenLastCalledWith("search", []);
    const escapeRef = { current: null as (() => boolean) | null };
    await act(async () =>
      root.render(
        createElement(SearchPanel, {
          open: false,
          engine,
          language: "en",
          onJump,
          onClose,
          onOpen: vi.fn(),
          escapeRef,
        }),
      ),
    );
    // The results bar, then Esc ends the search
    expect(host.textContent).toContain("1 of 1");
    expect(host.querySelector('[aria-label="Close search"]')?.getAttribute("data-tooltip")).toBe("Close search");
    await act(async () => {
      expect(escapeRef.current?.()).toBe(true);
    });
    expect(search.mock.calls[0][0].signal.aborted).toBe(true);
    expect(decorations).toHaveBeenLastCalledWith("search", []);
    expect(host.textContent).not.toContain("1 of 1");
    expect(escapeRef.current?.()).toBe(false);
    expect(decorations.mock.calls.every(([group]) => group === "search")).toBe(
      true,
    );
  });
  it("stays on its side as hits are picked, and names the query when nothing matches", async () => {
    vi.stubGlobal("innerWidth", 1280);
    let complete = true;
    const search = vi.fn(async function* (): AsyncGenerator<SearchUpdate> {
      if (complete) yield { kind: "hits", hits: [hit] };
      yield { kind: "complete", capped: false, count: complete ? 1 : 0 };
    });
    const engine = { search, currentLocator: () => null, setDecorations: vi.fn() } as unknown as ReaderEngine;
    const render = () =>
      root.render(
        createElement(SearchPanel, {
          open: true, engine, language: "en", onJump: vi.fn(async () => true),
          onClose: vi.fn(), onOpen: vi.fn(),
        }),
      );
    await act(async () => render());
    const field = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const type = async (text: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () =>
        host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
    };
    const side = () => host.querySelector("dialog")?.style.right === "0px" ? "right" : "left";
    await type("text");
    // On a wide screen the book insets beside the drawer (SLN-728): no hit
    // is under it, so picking one never moves the drawer
    expect(side()).toBe("left");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-hit]")!.click());
    expect(side()).toBe("left");
    complete = false;
    await type("zzqx");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("No matches for “zzqx”.");
    await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "No matches for “zzqx”. Whole words is on; turning it off may find more.",
    );
    // The field's own clear control
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click());
    expect(field.value).toBe("");
  });
  it("keeps one field while typing, uses switches, and docks its results bar in the bottom bar's place (SLN-727)", async () => {
    const search = vi.fn(async function* (): AsyncGenerator<SearchUpdate> {
      yield { kind: "hits", hits: [hit] };
      yield { kind: "complete", capped: false, count: 1 };
    });
    const engine = { search, currentLocator: () => null, setDecorations: vi.fn() } as unknown as ReaderEngine;
    const rect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-reader-search-bar") ? ({ height: 45 } as DOMRect) : rect.call(this);
    });
    const onDockHeight = vi.fn();
    const escapeRef = { current: null as (() => boolean) | null };
    const render = (open: boolean) =>
      root.render(
        createElement(SearchPanel, {
          open, engine, language: "en", onJump: vi.fn(async () => true),
          onClose: vi.fn(), onOpen: vi.fn(), escapeRef, onDockHeight,
        }),
      );
    await act(async () => render(true));
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect([...host.querySelectorAll('[role="switch"]')].map((item) => item.getAttribute("aria-labelledby") && document.getElementById(item.getAttribute("aria-labelledby")!)?.textContent))
      .toEqual(["Whole words", "Match case", "Match accents"]);
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe("Search");
    const field = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "text");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The clear button arrives without remounting the field (which would lose focus)
    expect(host.querySelector('[aria-label="Clear search"]')).not.toBeNull();
    expect(host.querySelector('input[type="search"]')).toBe(field);
    await act(async () =>
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onDockHeight).not.toHaveBeenCalledWith(45);
    await act(async () => render(false));
    expect(host.querySelector('[data-reader-search-bar] [role="toolbar"]')?.getAttribute("aria-label")).toBe("Search results");
    expect(onDockHeight).toHaveBeenLastCalledWith(45);
    await act(async () => {
      escapeRef.current?.();
    });
    expect(host.querySelector("[data-reader-search-bar]")).toBeNull();
    expect(onDockHeight).toHaveBeenLastCalledWith(0);
  });
  it("keeps focus on the field and on Next as Enter steps through the matches, though a jump focuses the book", async () => {
    const hits = [0, 1, 2].map((n) => ({
      ...hit, id: `0:${n}:9`, start: n * 10, end: n * 10 + 4,
      locator: { ...hit.locator, cfi: `epubcfi(/6/2!/4/${n + 2})`, position: 12 + n },
    }));
    const search = vi.fn(async function* (): AsyncGenerator<SearchUpdate> {
      yield { kind: "hits", hits };
      yield { kind: "complete", capped: false, count: hits.length };
    });
    const engine = { search, currentLocator: () => null, setDecorations: vi.fn() } as unknown as ReaderEngine;
    // The book: an EPUB jump focuses the passage it lands on
    const frame = Object.assign(document.createElement("div"), { id: "reader-book" });
    const book = document.createElement("div");
    book.tabIndex = -1;
    frame.append(book);
    document.body.append(frame);
    const onJump = vi.fn(async (_locator: SearchHit["locator"], _hit: SearchHit) => {
      book.focus();
      return true;
    });
    const render = (open: boolean) =>
      root.render(
        createElement(SearchPanel, { open, engine, language: "en", onJump, onClose: vi.fn(), onOpen: vi.fn() }),
      );
    await act(async () => render(true));
    const field = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    field.focus();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "text");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const enter = () =>
      act(async () => {
        host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    await enter();
    await enter();
    expect(onJump.mock.calls.map(([locator]) => locator.position)).toEqual([12, 13]);
    expect(document.activeElement).toBe(field);
    // Next in the results bar keeps the focus too
    await act(async () => render(false));
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Next match"]')!;
    next.focus();
    await act(async () => next.click());
    expect(onJump.mock.calls.at(-1)?.[0]?.position).toBe(14);
    expect(document.activeElement).toBe(next);
    frame.remove();
  });
  it("leaves the focus on a panel opened while a jump runs", async () => {
    const hits = [0, 1].map((n) => ({
      ...hit, id: `0:${n}:9`, start: n * 10, end: n * 10 + 4,
      locator: { ...hit.locator, cfi: `epubcfi(/6/2!/4/${n + 2})`, position: 12 + n },
    }));
    const search = vi.fn(async function* (): AsyncGenerator<SearchUpdate> {
      yield { kind: "hits", hits };
      yield { kind: "complete", capped: false, count: hits.length };
    });
    const engine = { search, currentLocator: () => null, setDecorations: vi.fn() } as unknown as ReaderEngine;
    const frame = Object.assign(document.createElement("div"), { id: "reader-book" });
    const book = document.createElement("div");
    book.tabIndex = -1;
    frame.append(book);
    // Contents, opened with T before the jump lands
    const contents = document.createElement("button");
    document.body.append(frame, contents);
    let land = () => {};
    const onJump = vi.fn(
      (_locator: SearchHit["locator"], _hit: SearchHit) =>
        onJump.mock.calls.length === 1 ? (book.focus(), Promise.resolve(true)) : new Promise<boolean>((resolve) => {
          land = () => {
            book.focus();
            contents.focus();
            resolve(true);
          };
        }),
    );
    const render = (open: boolean) =>
      root.render(
        createElement(SearchPanel, { open, engine, language: "en", onJump, onClose: vi.fn(), onOpen: vi.fn() }),
      );
    await act(async () => render(true));
    const field = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    field.focus();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "text");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => render(false));
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Next match"]')!;
    next.focus();
    await act(async () => next.click());
    expect(onJump).toHaveBeenCalledTimes(2);
    await act(async () => land());
    expect(document.activeElement).toBe(contents);
    frame.remove();
    contents.remove();
  });
  it("leaves a second Mod+F in the field to the browser", async () => {
    const engine = {
      currentLocator: () => null,
      setDecorations: vi.fn(),
    } as unknown as ReaderEngine;
    await act(async () =>
      root.render(
        createElement(SearchPanel, {
          open: true,
          engine,
          language: "en",
          onJump: vi.fn(),
          onClose: vi.fn(),
          onOpen: vi.fn(),
        }),
      ),
    );
    const field = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
