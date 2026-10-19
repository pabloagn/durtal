// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProgressScrubber } from "@/components/reader/progress-scrubber";
import { ContentsPanel } from "@/components/reader/contents-panel";
import { PositionIndex } from "@/lib/reader/position-index";
import {
  createReaderInput,
  registerReaderKey,
  registerCoreReaderShortcuts,
  getReaderShortcuts,
  type ReaderActions,
} from "@/lib/reader/input";
import { createHistoryInput } from "@/lib/reader/history-input";
import type { TocItem } from "@/lib/reader/engine";
const item = (
  href: string,
  label: string,
  subitems: TocItem[] = [],
): TocItem => ({ href, label, subitems });
const leaf = (href: string): TocItem => ({ href, label: href, subitems: [] });
const index = new PositionIndex(
  {
    title: "Book",
    authors: [],
    language: "en",
    dir: "ltr",
    layout: "reflowable",
    locationCount: 20,
    linearSize: 30000,
    pageList: [],
    toc: [
      item("a", "Parent", [item("a#child", "Child", [leaf("a#deep")])]),
      leaf("b"),
    ],
    sections: [
      { href: "a", label: "A", linear: true, start: 0, end: 0.8 },
      { href: "b", label: "B", linear: true, start: 0.8, end: 1 },
    ],
    capabilities: { search: true, tts: true, spreads: true, scrolled: true },
  },
  { "a#child": 0.2, "a#deep": 0.3 },
);
let host: HTMLElement, root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
    () => {},
  );
  vi.spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(
    () => {},
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const key = (
  element: Element | Document,
  value: string,
  options: KeyboardEventInit = {},
) => {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => element.dispatchEvent(event));
  return event;
};
const actions = (): ReaderActions => ({
  next: vi.fn(),
  prev: vi.fn(),
  left: vi.fn(),
  right: vi.fn(),
  first: vi.fn(),
  last: vi.fn(),
  toggleBars: vi.fn(),
  contents: vi.fn(),
  settings: vi.fn(),
  fullscreen: vi.fn(),
  escape: vi.fn(),
  goto: vi.fn(),
  chapter: vi.fn(),
  shortcuts: vi.fn(),
});
describe("owned controls", () => {
  it("previews slider keys without turning; Enter commits once and Escape restores ARIA", () => {
    const commit = vi.fn();
    const book = actions();
    const input = createReaderInput({ actions: book, isBlocked: () => false });
    input.attach(document);
    act(() =>
      root.render(
        h(ProgressScrubber, { fraction: 0.4, index, onCommit: commit }),
      ),
    );
    const slider = host.querySelector('[role="slider"]')!;
    key(slider, "ArrowRight");
    key(slider, "ArrowRight", { shiftKey: true });
    expect(slider.getAttribute("aria-valuenow")).toBe("51");
    expect(commit).not.toHaveBeenCalled();
    expect(book.right).not.toHaveBeenCalled();
    key(slider, "Enter");
    expect(commit).toHaveBeenCalledWith(0.51);
    expect(commit).toHaveBeenCalledOnce();
    key(slider, "Home");
    key(slider, "Escape");
    expect(slider.getAttribute("aria-valuenow")).toBe("40");
    expect(book.first).not.toHaveBeenCalled();
    input.destroy();
  });
  it("updates the Peek label without synchronously measuring its new width", () => {
    const commit = vi.fn();
    act(() => root.render(h(ProgressScrubber, { fraction: 0.4, index, onCommit: commit })));
    const slider = host.querySelector<HTMLElement>('[role="slider"]')!;
    const bubble = slider.querySelector<HTMLElement>("div.glass")!;
    const measured = vi.fn(() => { throw new Error("Peek label forces synchronous layout"); });
    Object.defineProperty(bubble, "offsetWidth", { get: measured });
    key(slider, "ArrowRight");
    expect(measured).not.toHaveBeenCalled();
    expect(bubble.textContent).toBe(slider.getAttribute("aria-valuetext"));
    expect(slider.getAttribute("aria-valuenow")).toBe("41");
    expect(commit).not.toHaveBeenCalled();
    key(slider, "Escape");
    expect(slider.getAttribute("aria-valuenow")).toBe("40");
  });
  it("keeps pointer Peek local; pointer cancel and release above the 64px line never commit", async () => {
    const commit = vi.fn();
    act(() =>
      root.render(
        h(ProgressScrubber, { fraction: 0.4, index, onCommit: commit }),
      ),
    );
    const slider = host.querySelector<HTMLElement>('[role="slider"]')!;
    slider.getBoundingClientRect = () => new DOMRect(0, 100, 220, 24);
    const pointer = (type: string, x: number, y: number) =>
      act(() =>
        slider.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            clientX: x,
            clientY: y,
            button: 0,
            bubbles: true,
          }),
        ),
      );
    pointer("pointerdown", 110, 110);
    pointer("pointermove", 160, 110);
    await act(async () => {
      await new Promise((done) => requestAnimationFrame(done));
    });
    expect(commit).not.toHaveBeenCalled();
    pointer("pointercancel", 160, 110);
    pointer("pointerdown", 160, 110);
    pointer("pointerup", 160, 20);
    expect(commit).not.toHaveBeenCalled();
    pointer("pointerdown", 165, 110);
    pointer("pointerup", 165, 110);
    expect(commit).toHaveBeenCalledWith(0.75);
    expect(commit).toHaveBeenCalledOnce();
  });
  it("lists a PDF's pages as pages when it has no contents (SLN-731)", async () => {
    const pdf = new PositionIndex(
      {
        title: "Scan",
        authors: [],
        language: "en",
        dir: "ltr",
        layout: "pre-paginated",
        locationCount: 2,
        linearSize: 2,
        pageList: [],
        toc: [],
        pagedSections: true,
        sections: [
          { href: "0", label: "Page 1", linear: true, start: 0, end: 0.5 },
          { href: "1", label: "Page 2", linear: true, start: 0.5, end: 1 },
        ],
        capabilities: { search: true, tts: false, spreads: true, scrolled: true },
      },
      {},
    );
    await act(async () => {
      root.render(h(ContentsPanel, { open: true, index: pdf, current: null, onClose: vi.fn(), onPick: vi.fn(async () => true) }));
    });
    expect(document.body.textContent).toContain("Its pages are listed in order.");
    expect(document.body.textContent).toContain("Page 2");
    expect(document.body.textContent).not.toMatch(/section/i);
  });
  it("reveals current ancestors, uses one roving tree stop and owns arrows, wheel and touch", async () => {
    const book = actions(),
      close = vi.fn(),
      pick = vi.fn(async () => true);
    const input = createReaderInput({ actions: book, isBlocked: () => false });
    input.attach(document);
    await act(async () => {
      root.render(
        h(ContentsPanel, {
          open: true,
          index,
          current: leaf("a#deep"),
          onClose: close,
          onPick: pick,
        }),
      );
      await new Promise((done) => requestAnimationFrame(done));
    });
    const current = host.querySelector('[aria-current="location"]')!;
    expect(current).toBeTruthy();
    expect(
      host.querySelectorAll('[role="treeitem"][tabindex="0"]'),
    ).toHaveLength(1);
    key(current, "ArrowLeft");
    expect(document.activeElement?.textContent).toContain("Child");
    act(() =>
      current.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 100, bubbles: true }),
      ),
    );
    key(current, "End");
    key(document.activeElement!, "Enter");
    await act(async () => {
      await Promise.resolve();
    });
    expect(pick).toHaveBeenCalledWith("b");
    expect(close).toHaveBeenCalledOnce();
    expect(book.right).not.toHaveBeenCalled();
    expect(book.next).not.toHaveBeenCalled();
    expect(book.last).not.toHaveBeenCalled();
    input.destroy();
  });
  it("leaves browser Back available at history edges, and modal/editable surfaces take precedence", () => {
    let available = false,
      blocked = false;
    const step = vi.fn();
    const history = createHistoryInput({
      blocked: () => blocked,
      available: () => available,
      step,
    });
    history.attach(document);
    expect(key(document, "ArrowLeft", { altKey: true }).defaultPrevented).toBe(
      false,
    );
    available = true;
    expect(key(document, "ArrowLeft", { altKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(step).toHaveBeenCalledWith(-1);
    blocked = true;
    expect(key(document, "ArrowRight", { altKey: true }).defaultPrevented).toBe(
      false,
    );
    blocked = false;
    const field = document.createElement("input");
    host.append(field);
    expect(key(field, "ArrowLeft", { altKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(step).toHaveBeenCalledOnce();
    history.destroy();
  });
  // Documents are held weakly now (SLN-1291): destroy still reaches every one alive
  it("stops listening on every attached page document when destroyed", () => {
    const step = vi.fn();
    const history = createHistoryInput({ blocked: () => false, available: () => true, step });
    const pages = [0, 1, 2].map(() => document.implementation.createHTMLDocument("page"));
    const removers = pages.map((page) => history.attach(page));
    removers[1]();
    expect(key(pages[1], "ArrowLeft", { altKey: true }).defaultPrevented).toBe(false);
    expect(key(pages[0], "ArrowLeft", { altKey: true }).defaultPrevented).toBe(true);
    history.destroy();
    for (const page of pages) expect(key(page, "ArrowRight", { altKey: true }).defaultPrevented).toBe(false);
    expect(step).toHaveBeenCalledOnce();
  });
  it("handles Shift-? and AltGr chapters, reserves future epic keys and reports only registered shortcuts", () => {
    const book = actions();
    const input = createReaderInput({ actions: book, isBlocked: () => false });
    input.attach(document);
    key(document, "?", { shiftKey: true });
    expect(book.shortcuts).toHaveBeenCalledOnce();
    const altGr = new KeyboardEvent("keydown", {
      key: "]",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    altGr.getModifierState = (key) => key === "AltGraph";
    act(() => document.dispatchEvent(altGr));
    expect(book.chapter).toHaveBeenCalledWith(1);
    expect(key(document, "]", { ctrlKey: true }).defaultPrevented).toBe(false);
    for (const reserved of [
      "b",
      "h",
      "n",
      "d",
      "a",
      "/",
      "+",
      "-",
      "0",
      "p",
      "w",
    ])
      expect(() => registerReaderKey(reserved, vi.fn())).toThrow("reserves");
    const offCore = registerCoreReaderShortcuts(["g", "?"]);
    const offPlugin = registerReaderKey("q", vi.fn(), {
      when: "selection",
      label: "Save quote",
    });
    expect(getReaderShortcuts().map((shortcut) => shortcut.label)).toEqual([
      "Go to",
      "Reader shortcuts",
      "Save quote",
    ]);
    offPlugin();
    offCore();
    input.destroy();
  });
});
