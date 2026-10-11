// @vitest-environment happy-dom
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LookupPopover, type LookupTab } from "@/components/reader/lookup/lookup-popover";
import { BrowserLookupTranslator } from "@/lib/reader/lookup/browser-translator";
import { defaultLookupSettings } from "@/lib/reader/lookup/sources";
import type { SelectionDetails } from "@/lib/reader/engine";
const roots: Root[] = [], elements: HTMLElement[] = [];
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value() {} });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { act(() => roots.forEach(root => root.unmount())); roots.length = 0; elements.forEach(element => element.remove()); elements.length = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const details: SelectionDetails = { text: "lux", sentence: "Lux lucet.", lang: "la",
  locator: { v: 1, fileHash: "a".repeat(64), href: "chapter", sectionIndex: 0, progression: 0, totalProgression: 0 },
  rect: new DOMRectReadOnly(200, 200, 20, 20) };
function render(passage = false, keyboard = false, onClose = vi.fn(), rect = details.rect) {
  const element = document.createElement("div"); document.body.append(element); elements.push(element);
  const root = createRoot(element); roots.push(root);
  function Harness() {
    const [active, setActive] = useState<LookupTab>(passage ? "translate" : "dictionary");
    return h(LookupPopover, { details: { ...details, rect, text: passage ? "one two three four five six" : details.text },
      language: "la", guessed: false, word: passage ? "one two three four five six" : "lux", passage, keyboard,
      avoid: null, settings: defaultLookupSettings(), target: "en", translator: new BrowserLookupTranslator(),
      dictionary: { packs: [], entries: [], packsPending: true, packError: null, english: null, own: null, offline: false },
      wikipedia: { value: null, pending: true, offline: false }, active, onTab: setActive,
      onLanguage: vi.fn(), onTarget: vi.fn(), onClose });
  }
  act(() => root.render(h(Harness))); return { element, onClose };
}
describe("lookup popover source structure (native positioning acceptance separate)", () => {
  it("mounts skeleton synchronously, keeps header/tabs outside the scrolling body, and names Close", () => {
    const { element } = render();
    const outer = element.querySelector('[role="dialog"]')!;
    expect(outer.classList.contains("glass")).toBe(true);
    expect(outer.classList.contains("overflow-hidden")).toBe(true);
    const body = outer.querySelector("[data-reader-popover-body]")!;
    expect(body.classList.contains("overflow-y-auto")).toBe(true);
    expect(body.querySelector("[data-lookup-skeleton]")).not.toBeNull();
    expect(body.contains(outer.querySelector('[role="tablist"]'))).toBe(false);
    expect(outer.getAttribute("aria-label")).toBe("Look up lux");
    expect(outer.getAttribute("aria-modal")).toBe("false");
    expect(outer.querySelector('button[aria-label="Close lookup"]')?.getAttribute("data-tooltip")).toBe("Close");
  });
  it("keyboard opening focuses the active tab and Arrow/Home/End keep roving focus", () => {
    const { element } = render(false, true);
    const tabs = Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(document.activeElement).toBe(tabs[0]);
    act(() => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(tabs[3]); expect(tabs[3].getAttribute("aria-selected")).toBe("true");
    act(() => tabs[3].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(tabs[0]);
    act(() => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(tabs[0]);
  });
  it("passages render only Your sources and Translate", () => {
    const { element } = render(true);
    expect(Array.from(element.querySelectorAll('[role="tab"]')).map(tab => tab.textContent)).toEqual(["Your sources", "Translate"]);
    expect(element.textContent).toContain("Open in Google Translate");
  });
  it("gesture opening preserves focus and Escape supplies the close reason", () => {
    const book = document.createElement("button"); document.body.append(book); elements.push(book); book.focus();
    const { onClose } = render();
    expect(document.activeElement).toBe(book);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledWith("escape");
  });
  it("result updates reposition without cycling the native popover", () => {
    const show = vi.spyOn(HTMLElement.prototype, "showPopover");
    const { element } = render();
    const tabs = element.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(show).toHaveBeenCalledTimes(1);
    act(() => tabs[2].click());
    expect(show).toHaveBeenCalledTimes(1);
  });
  it.each([{ width: 390, height: 844 }, { width: 1440, height: 900 }])
    ("applies a usable fallback to a mounted viewport-spanning passage in %j", viewport => {
      vi.stubGlobal("innerWidth", viewport.width); vi.stubGlobal("innerHeight", viewport.height);
      const { element, onClose } = render(true, true, vi.fn(), new DOMRectReadOnly(20, -500, 100, 2000));
      const outer = element.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(outer.style.minHeight).toBe("220px");
      expect(parseFloat(outer.style.maxHeight)).toBeGreaterThanOrEqual(220);
      expect(parseFloat(outer.style.top)).toBeGreaterThanOrEqual(16);
      expect(document.activeElement).toBe(outer.querySelector('[role="tab"][aria-selected="true"]'));
      const body = outer.querySelector<HTMLElement>("[data-reader-popover-body]")!;
      expect(body.classList.contains("overflow-y-auto")).toBe(true);
      expect(body.contains(outer.querySelector('[role="tablist"]'))).toBe(false);
      const close = outer.querySelector<HTMLButtonElement>('button[aria-label="Close lookup"]')!;
      expect(body.contains(close)).toBe(false);
      act(() => close.click()); expect(onClose).toHaveBeenCalledWith("button");
    });
});
