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
  it("moves off a hit it would cover, and names the query when nothing matches", async () => {
    vi.stubGlobal("innerWidth", 1280);
    let complete = true;
    const search = vi.fn(async function* (): AsyncGenerator<SearchUpdate> {
      if (complete) yield { kind: "hits", hits: [hit] };
      yield { kind: "complete", capped: false, count: complete ? 1 : 0 };
    });
    const engine = { search, currentLocator: () => null, setDecorations: vi.fn() } as unknown as ReaderEngine;
    let rect = { left: 84, right: 133 };
    const render = () =>
      root.render(
        createElement(SearchPanel, {
          open: true, engine, language: "en", onJump: vi.fn(async () => true),
          onClose: vi.fn(), onOpen: vi.fn(), hitRect: () => rect,
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
    // A hit under the left drawer sends it right; one under the right drawer sends it back
    expect(side()).toBe("right");
    rect = { left: 1100, right: 1150 };
    await act(async () => host.querySelector<HTMLButtonElement>("[data-hit]")!.click());
    expect(side()).toBe("left");
    // A hit clear of the drawer leaves it where it is
    rect = { left: 600, right: 650 };
    await act(async () => host.querySelector<HTMLButtonElement>("[data-hit]")!.click());
    expect(side()).toBe("left");
    complete = false;
    await type("zzqx");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("No matches for “zzqx”.");
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "No matches for “zzqx”. Whole words is on; turning it off may find more.",
    );
    // The field's own clear control
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click());
    expect(field.value).toBe("");
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
