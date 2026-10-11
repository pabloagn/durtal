// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FoliateBook, FoliateProgress } from "./foliate";
import type { DurtalLocator } from "@/lib/reader/engine";
vi.mock("@/vendor/foliate-js/vendor/zip.js", () => ({}));
vi.mock("@/lib/reader/engines/foliate/zip-reader", () => ({ makeRangeZipLoader: async () => ({ entries: [], loadText: async () => null }) }));
vi.mock("@/vendor/foliate-js/epub.js", () => ({ EPUB: class {
  async init(): Promise<FoliateBook> { return { sections: [{ id: "chapter", size: 6000 }], resolveHref: () => ({ index: 0 }) }; }
} }));
vi.mock("@/vendor/foliate-js/view.js", () => ({}));
import * as CFI from "@/vendor/foliate-js/epubcfi.js";
import { focusNavigationAnchor, getNavigationAnchorFocus } from "@/vendor/foliate-js/paginator.js";
import { createFoliateEngine } from "./engine";
import { createReaderNavigation } from "@/lib/reader/navigation";
import { presentationFrom, resolveThemeColors } from "@/lib/reader/presentation";
import { READER_DEFAULTS } from "@/lib/reader/settings-cookie";

class FocusView extends HTMLElement {
  frame = document.createElement("iframe");
  origin!: Range;
  destination!: Range;
  lastLocation: FoliateProgress | null = null;
  renderer = Object.assign(document.createElement("div"), {
    atEnd: false,
    getContents: () => [{ doc: this.frame.contentDocument!, index: 0 }],
    setStyles() {},
    goTo: async (target: { index: number; anchor?: number | ((doc: Document) => Range | Element) }) => {
      const range = typeof target.anchor === "function" ? target.anchor(this.frame.contentDocument!) : this.destination;
      if (!("startContainer" in range)) throw new Error("Expected the actual CFI range");
      this.land(range, "navigation");
      const parent = range.startContainer.nodeType === 1 ? range.startContainer as HTMLElement : range.startContainer.parentElement!;
      parent.tabIndex = -1;
      // The exact production call used by Paginator after scrolling a CFI.
      focusNavigationAnchor(this.renderer, parent);
    },
  });
  constructor() {
    super();
    Object.defineProperty(this.renderer, "navigationAnchorFocus", { get: () => getNavigationAnchorFocus(this.renderer) });
  }
  async open() {
    this.append(this.renderer); this.renderer.append(this.frame);
    const doc = this.frame.contentDocument!;
    doc.body.innerHTML = `<p id="origin" tabindex="-1">${"Origin paragraph with exact saved words. ".repeat(6)}</p><p id="destination" tabindex="-1">${"Destination paragraph with other words. ".repeat(6)}</p>`;
    const partial = (id: string) => {
      const range = doc.createRange(), text = doc.getElementById(id)!.firstChild!;
      range.setStart(text, 20); range.setEnd(text, 110); return range;
    };
    this.origin = partial("origin"); this.destination = partial("destination");
    this.dispatchEvent(new CustomEvent("load", { detail: { doc, index: 0 } }));
  }
  land(range: Range, reason: string) {
    const element = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement!;
    const fraction = element.closest("p")?.id === "origin" ? 0.4 : 0.7;
    this.lastLocation = { reason, index: 0, fraction, sectionFraction: fraction, cfi: this.getCFI(0, range), range };
    this.dispatchEvent(new CustomEvent("relocate", { detail: this.lastLocation }));
  }
  async init() { this.land(this.origin, "page"); }
  async goToFraction() { this.land(this.destination, "anchor"); }
  getCFI(index: number, range: Range) { return CFI.joinIndir(CFI.fake.fromIndex(index), CFI.fromRange(range, undefined)); }
  getSectionFractions() { return [0, 1]; }
  getProgressOf() { return {}; }
  resolveNavigation(target: unknown) {
    if (typeof target !== "string" || !CFI.isCFI.test(target)) throw new Error("Expected a real saved CFI");
    const parts = CFI.parse(target);
    const parent = "parent" in parts ? parts.parent : parts;
    const index = CFI.fake.toIndex(parent.shift());
    return { index, anchor: (doc: Document) => CFI.toRange(doc, parts, undefined) as Range };
  }
  close() {}
}
beforeAll(() => { if (!customElements.get("foliate-view")) customElements.define("foliate-view", FocusView); });
afterEach(() => { vi.restoreAllMocks(); });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

describe("renderer anchor focus and owned history", () => {
  it.each(["commit", "human-focus", "focus-error"] as const)("keeps programmatic CFI focus inside its owner while preserving%s", async outcome => {
    const host = document.createElement("div"); document.body.append(host);
    const engine = createFoliateEngine();
    await engine.open({ ebookId: "book", fileId: "epub", format: "epub", size: 1000, sha256: "a".repeat(64), url: "/unused", fallbackUrl: "/unused" },
      { container: host, presentation: presentationFrom(READER_DEFAULTS, resolveThemeColors(), "") });
    const view = host.querySelector("foliate-view") as FocusView;
    const doc = view.frame.contentDocument!, originNode = doc.getElementById("origin")!, destinationNode = doc.getElementById("destination")!;
    // Native cause: CFI begins partway through a paragraph; focusing its first
    // text point is outside the observed visible range, not a new user move.
    expect(view.origin.comparePoint(originNode.firstChild!, 0)).toBe(-1);
    const raw: import("@/lib/reader/engine").EngineEvents["relocate"][] = [];
    const offRaw = engine.on("relocate", event => { raw.push(event); });
    view.land(view.origin, "page");
    const start = raw.at(-1)!;
    let held = false;
    const paintStarted = deferred(), paintRelease = deferred();
    const commit = vi.fn(), beforeHuman = vi.fn();
    const navigation = createReaderNavigation({ engine, commit, beforeHuman, paint: async () => {
      if (held) { paintStarted.resolve(); await paintRelease.promise; }
    } });
    navigation.start(start);
    const humanMoves: Promise<DurtalLocator | null>[] = [];
    const focus = vi.fn(({ locator }: { locator: DurtalLocator }) => { humanMoves.push(navigation.focusTo(locator)); });
    const offFocus = engine.on("focus", focus), off = engine.on("relocate", event => navigation.relocate(event));
    const goto = vi.spyOn(engine, "goTo");
    const nativeFocus = vi.fn((event: FocusEvent) => {
      if (event.target === originNode) expect(getNavigationAnchorFocus(view.renderer)).toBe(originNode);
    });
    doc.addEventListener("focusin", nativeFocus);
    try {
      await navigation.navigate({ fraction: 0.7 }, { source: "goto" });
      const destination = navigation.current!.locator;
      expect(destination.cfi).not.toBe(start.locator.cfi);
      expect(navigation.history.cursor).toBe(1);
      expect(beforeHuman).toHaveBeenCalledOnce();
      commit.mockClear();
      if (outcome === "focus-error") {
        vi.spyOn(originNode, "focus").mockImplementationOnce(() => { throw new Error("genuine native focus failure"); });
        await expect(navigation.historyStep(-1)).rejects.toThrow("genuine native focus failure");
        expect(getNavigationAnchorFocus(view.renderer)).toBeNull();
        expect(focus).not.toHaveBeenCalled();
        expect(navigation.history.cursor).toBe(1);
        expect(navigation.history.forward).toBeNull();
        expect(commit).not.toHaveBeenCalled();
        expect(engine.currentLocator()?.cfi).toBe(destination.cfi);
        return;
      }
      held = true;
      const back = navigation.historyStep(-1);
      await paintStarted.promise;
      const owner = goto.mock.calls[1][1]!;
      expect(owner.signal.aborted).toBe(false);
      expect(nativeFocus).toHaveBeenCalled();
      expect(doc.activeElement).toBe(originNode); // accessibility focus retained
      expect(getNavigationAnchorFocus(view.renderer)).toBeNull(); // only synchronous scope
      expect(engine.currentLocator()?.cfi).toBe(start.locator.cfi);
      expect(view.lastLocation?.range?.toString()).toBe(view.origin.toString());
      expect(engine.currentLocator()?.text).toEqual(start.locator.text);
      expect(focus).not.toHaveBeenCalled();
      expect(beforeHuman).toHaveBeenCalledTimes(2);
      expect(commit).not.toHaveBeenCalled();
      expect(navigation.history.cursor).toBe(1); // still gated on paint
      if (outcome === "human-focus") {
        // Native unmarked focus (e.g. Tab/link) during the pending paint still
        // enters actual adapter focus -> controller admission/cancellation.
        destinationNode.focus({ preventScroll: true });
        expect(focus).toHaveBeenCalledOnce();
        expect(beforeHuman).toHaveBeenCalledTimes(3);
        expect(owner.signal.aborted).toBe(true);
      }
      paintRelease.resolve();
      if (outcome === "human-focus") {
        await expect(back).resolves.toBeNull();
        await Promise.all(humanMoves);
        expect(navigation.history.cursor).toBe(1);
        expect(navigation.history.forward).toBeNull();
        expect(navigation.history.entries).toHaveLength(2);
      } else {
        await expect(back).resolves.toMatchObject({ cfi: start.locator.cfi, text: start.locator.text });
        expect(navigation.history.cursor).toBe(0);
        expect(navigation.history.forward?.locator.cfi).toBe(destination.cfi);
        expect(commit).toHaveBeenCalledOnce();
        expect(goto).toHaveBeenCalledTimes(2); // no recovery/paragraph substitute
        // After native internal focus exits, ordinary user focus remains live.
        destinationNode.focus({ preventScroll: true });
        expect(focus).toHaveBeenCalledOnce();
        await Promise.all(humanMoves);
        expect(navigation.history.cursor).toBe(0);
        expect(navigation.history.forward?.locator.cfi).toBe(destination.cfi);
      }
    } finally {
      paintRelease.resolve(); doc.removeEventListener("focusin", nativeFocus);
      off(); offFocus(); offRaw(); navigation.destroy(); engine.destroy(); host.remove();
    }
  });

  it("restores the exact prior synchronous focus scope after nested native focus", () => {
    const renderer = document.createElement("div"), otherRenderer = document.createElement("div");
    const outer = document.createElement("button"), inner = document.createElement("button");
    document.body.append(outer, inner);
    const seen: string[] = [];
    outer.addEventListener("focus", () => {
      expect(getNavigationAnchorFocus(renderer)).toBe(outer);
      expect(getNavigationAnchorFocus(otherRenderer)).toBeNull();
      focusNavigationAnchor(renderer, inner);
      expect(getNavigationAnchorFocus(renderer)).toBe(outer);
      seen.push("outer-restored");
    });
    inner.addEventListener("focus", () => {
      expect(getNavigationAnchorFocus(renderer)).toBe(inner); seen.push("inner");
    });
    try {
      focusNavigationAnchor(renderer, outer);
      expect(seen).toEqual(["inner", "outer-restored"]);
      expect(getNavigationAnchorFocus(renderer)).toBeNull();
    } finally { outer.remove(); inner.remove(); }
  });
});
