// @vitest-environment happy-dom
// Real engine, input and mounted lookup consumers; only vendor rendering and
// external/storage acquisition are fixtures. This is not native browser proof.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { SelectionToolbar } from "@/components/reader/selection-toolbar";
import { LookupLayer } from "@/components/reader/lookup/lookup-layer";
import { createFoliateEngine } from "@/lib/reader/engines/foliate/engine";
import { createReaderInput, type ReaderActions } from "@/lib/reader/input";
import { presentationFromPreferences } from "@/lib/reader/presentation";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";
import { canPreflightCoreFonts } from "@/lib/reader/presentation/font-route";
import { defaultLookupSettings } from "@/lib/reader/lookup/sources";
import type { ReaderEngine } from "@/lib/reader/engine";
import type { FoliateBook, FoliateProgress } from "@/lib/reader/engines/foliate/foliate";

const calls = vi.hoisted(() => ({ dictionary: vi.fn(), wikipedia: vi.fn(), history: vi.fn(),
  sectionLoad: vi.fn(async function (this: { id: string | number }) { return `section:${this.id}`; }),
  sectionText: vi.fn(async () => "unscanned source"),
}));
vi.mock("@/vendor/foliate-js/vendor/zip.js", () => ({}));
vi.mock("@/vendor/foliate-js/view.js", () => ({}));
vi.mock("@/lib/reader/engines/foliate/zip-reader", () => ({
  makeRangeZipLoader: async () => ({ entries: [], loadText: async () => "" }),
}));
vi.mock("@/vendor/foliate-js/epub.js", () => ({ EPUB: class {
  async init() { return { sections: [
    { id: "earlier", size: 100, linear: "yes", load: calls.sectionLoad, loadText: calls.sectionText },
    { id: "later", size: 100, linear: "yes", load: calls.sectionLoad, loadText: calls.sectionText },
  ], metadata: { title: "Two documents" }, resolveHref: () => ({ index: 0 }) }; }
} }));
vi.mock("@/lib/actions/reader-lookup", () => ({ getLookupSettings: async () => defaultLookupSettings() }));
vi.mock("@/lib/reader/lookup/wiktionary", () => ({ lookupWiktionary: calls.dictionary }));
vi.mock("@/lib/reader/lookup/wikipedia", () => ({ lookupWikipedia: calls.wikipedia }));
vi.mock("@/lib/reader/lookup/pack-store", () => ({ browserPackStore: () => ({ list: async () => [], close() {} }) }));
vi.mock("@/lib/reader/lookup/packs", () => ({ LookupPacksClient: class { close() {} } }));
vi.mock("@/lib/reader/lookup/history", () => ({
  browserLookupHistoryStore: () => ({ add: calls.history, updateLanguage: async () => {}, close() {} }),
  recordLookupHistory: (store: { add(input: unknown): Promise<number> }, input: unknown) => store.add(input),
}));

class TwoDocumentView extends HTMLElement {
  styles = "";
  frames = [document.createElement("iframe"), document.createElement("iframe")];
  renderer = Object.assign(document.createElement("div"), {
    atEnd: false,
    getContents: () => this.frames.map((frame, index) => ({ doc: frame.contentDocument!, index })),
    setStyles: (styles: string) => { this.styles = styles; },
  });
  lastLocation: FoliateProgress | null = null;
  book: FoliateBook | null = null;
  loadedSections: unknown[] = [];
  async open(book: FoliateBook) {
    this.book = book;
    // Exercise the actual engine's installed resource guards before DOM load.
    this.loadedSections = await Promise.all(book.sections.map(section => section.load!()));
    this.append(this.renderer); this.renderer.append(...this.frames);
    const markup = ['<p lang="la">Lux lucet.</p>', '<p lang="es">La casa brilla.</p>'];
    this.frames.forEach((frame, index) => {
      frame.contentDocument!.body.innerHTML = markup[index];
      this.dispatchEvent(new CustomEvent("load", { detail: { doc: frame.contentDocument!, index } }));
    });
  }
  async init() {
    this.lastLocation = { reason: "page", fraction: 0, index: 0, sectionFraction: 0, cfi: "start", range: null };
    this.dispatchEvent(new CustomEvent("relocate", { detail: this.lastLocation }));
  }
  getSectionFractions() { return [0, .5, 1]; }
  getCFI(index: number, range: Range) { return `epubcfi(${index}:${range.toString()})`; }
  getProgressOf() { return {}; }
  close() {}
}

let engine: ReaderEngine, view: TwoDocumentView, root: Root;
let bookHost: HTMLDivElement, lookupHost: HTMLDivElement, frames: FrameRequestCallback[];
let input: ReturnType<typeof createReaderInput>;
beforeAll(() => {
  if (!customElements.get("foliate-view")) customElements.define("foliate-view", TwoDocumentView);
});
beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear();
  calls.history.mockResolvedValue(1);
  calls.dictionary.mockImplementation(async (_language, _words, _signal, _client, updates) => {
    const english = { status: "fulfilled", value: { found: false, sections: [] } };
    const own = { status: "fulfilled", value: null };
    updates.english(english); updates.own(own); return { english, own };
  });
  calls.wikipedia.mockResolvedValue({ found: false, error: null });
  Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value() {} });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  bookHost = document.createElement("div"); lookupHost = document.createElement("div");
  document.body.append(bookHost, lookupHost);
  engine = createFoliateEngine();
  await engine.open({ ebookId: "467ab36f-bbd0-4807-8e37-abdf0f6b9577", fileId: "epub", format: "epub",
    size: 1000, sha256: "a".repeat(64), url: "/unused", fallbackUrl: "/unused" },
  { container: bookHost, presentation: presentationFromPreferences({ ...PRESENTATION_DEFAULTS.desktop, font: "garamond" }, "") });
  view = bookHost.querySelector("foliate-view") as TwoDocumentView;
  frames = [];
  // Engine opening uses real paint scheduling; provider scheduling is then manual.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const methods = ["next", "prev", "left", "right", "first", "last", "toggleBars", "contents", "settings", "fullscreen", "escape"];
  const actions = Object.fromEntries(methods.map(name => [name, vi.fn()])) as unknown as ReaderActions;
  input = createReaderInput({ actions, isBlocked: () => false,
    hasSelection: () => view.renderer.getContents().some(({ doc }) => !!doc.getSelection()?.toString()) });
  input.attach(document); view.renderer.getContents().forEach(({ doc }) => input.attach(doc));
  const toolbar = { current: null as HTMLDivElement | null };
  root = createRoot(lookupHost);
  act(() => root.render(h(ReaderBridgeProvider, {
    context: { ebookId: "467ab36f-bbd0-4807-8e37-abdf0f6b9577", fileId: "epub", format: "epub",
      selection: null, chapter: null, percent: null, locator: null }, plugins: [],
    children: bridge => h("div", null,
      h(SelectionToolbar, { ref: toolbar, bridge, selection: null, onClear() {} }),
      h(LookupLayer, { engine, ebook: { id: "467ab36f-bbd0-4807-8e37-abdf0f6b9577", title: "Two documents", language: "en" }, toolbarRef: toolbar })),
  })));
});
afterEach(() => {
  act(() => root.unmount()); input.destroy(); engine.destroy(); bookHost.remove(); lookupHost.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function paint() {
  const batch = frames.splice(0);
  await act(async () => { batch.forEach(callback => callback(performance.now())); await Promise.resolve(); });
}
function retainedSelections() {
  return view.frames.map((frame, index) => {
    const doc = frame.contentDocument!, node = doc.querySelector("p")!.firstChild!;
    const range = doc.createRange(); range.setStart(node, index ? 3 : 0); range.setEnd(node, index ? 7 : 3);
    doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
    Object.defineProperty(doc.defaultView!, "frameElement", { configurable: true, value: frame });
    Object.defineProperty(frame, "offsetWidth", { configurable: true, value: 200 });
    Object.defineProperty(frame, "offsetHeight", { configurable: true, value: 300 });
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(index ? 400 : 0, index ? 200 : 0, 400, 600));
    // Cloned ranges must retain native geometry just as they do in a browser.
    vi.spyOn(Object.getPrototypeOf(range), "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 30, 40));
    vi.spyOn(Object.getPrototypeOf(range), "getClientRects").mockReturnValue([new DOMRect(10, 20, 30, 40)] as unknown as DOMRectList);
    return doc;
  });
}
describe("lookup originating document with an earlier retained native selection", () => {
  it("preserves disabled font routing, guarded resource ownership and live lookup across a colour edit", async () => {
    expect(canPreflightCoreFonts()).toBe(false);
    expect(calls.sectionText).not.toHaveBeenCalled();
    expect(view.loadedSections).toEqual(["section:earlier", "section:later"]);
    expect(calls.sectionLoad.mock.contexts).toEqual(view.book!.sections);
    expect(view.styles).toContain("Durtal EB Garamond");
    expect(view.styles).not.toContain("Durtal EB Garamond Core");
    const oldColours = view.frames[1].contentDocument!.querySelector("style[data-durtal-page-colours]")!.textContent;
    const styles = vi.spyOn(view.renderer, "setStyles");
    engine.setPresentation(presentationFromPreferences({ ...PRESENTATION_DEFAULTS.desktop, font: "garamond", theme: "paper" }, ""));
    expect(styles).not.toHaveBeenCalled();
    expect(view.frames[1].contentDocument!.querySelector("style[data-durtal-page-colours]")!.textContent).not.toBe(oldColours);
    const [, later] = retainedSelections();
    act(() => later.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { button: 0, bubbles: true })));
    expect(calls.history).toHaveBeenCalledWith(expect.objectContaining({ word: "casa", language: "es", sentence: "La casa brilla." }));
    await paint(); await paint();
    expect(calls.dictionary).toHaveBeenCalledWith("es", ["casa"], expect.any(AbortSignal), undefined, expect.any(Object));
    const section = view.book!.sections[1];
    engine.destroy();
    await expect(section.load!()).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.sectionLoad).toHaveBeenCalledTimes(2);
  });
  it.each(["mouse", "touch", "shortcut"] as const)("binds the real %s path, locator and mounted consumers to the later document", async kind => {
    const [earlier, later] = retainedSelections();
    const gestures = vi.fn(), cfi = vi.spyOn(view, "getCFI"); engine.on("word-gesture", gestures);
    const selectionDetails = vi.spyOn(engine, "selectionDetails");
    if (kind === "touch") vi.useFakeTimers();
    act(() => {
      if (kind === "shortcut") later.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true }));
      else if (kind === "mouse") later.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { button: 0, bubbles: true }));
      else {
        const event = new Event("touchstart", { bubbles: true });
        Object.defineProperty(event, "touches", { value: [{ identifier: 1, clientX: 20, clientY: 30 }] });
        later.querySelector("p")!.dispatchEvent(event); vi.advanceTimersByTime(450);
      }
    });
    if (kind === "shortcut") expect(selectionDetails).toHaveBeenCalledWith(later);
    const details = kind === "shortcut" ? engine.selectionDetails(later)! : gestures.mock.calls[0][0].details;
    expect(details).toMatchObject({ text: "casa", lang: "es", sentence: "La casa brilla.",
      locator: { href: "later", sectionIndex: 1, cfi: "epubcfi(1:casa)", text: { highlight: "casa" } } });
    expect(details.rect.toJSON()).toMatchObject({ left: 420, top: 240, right: 480, bottom: 320 });
    expect(cfi.mock.calls.every(([index, range]) => index === 1 && range.startContainer.ownerDocument === later)).toBe(true);
    if (kind !== "shortcut") expect(gestures.mock.calls[0][0]).toMatchObject({ document: later, input: kind });
    expect(engine.selectionDetails()?.text).toBe("casa");
    expect(engine.locatorFromSelection()?.sectionIndex).toBe(1);
    expect(earlier.getSelection()!.toString()).toBe("Lux");
    expect(lookupHost.querySelector('[aria-label="Look up casa"]')).not.toBeNull();
    expect(calls.history).toHaveBeenCalledWith(expect.objectContaining({ word: "casa", language: "es", sentence: "La casa brilla." }));
    await paint(); await paint();
    expect(calls.dictionary).toHaveBeenCalledWith("es", ["casa"], expect.any(AbortSignal), undefined, expect.any(Object));
    // The exact originating document owns Escape, in addition to the host.
    act(() => later.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(lookupHost.querySelector('[role="dialog"]')).toBeNull();
  });
  it("keeps the captured gesture word and locator together if a selection listener changes the native range", async () => {
    const [earlier, later] = retainedSelections(), gestures = vi.fn();
    engine.on("word-gesture", gestures);
    engine.on("selection", selection => {
      if (!selection) return;
      const range = later.createRange(); range.setStart(later.querySelector("p")!.firstChild!, 0);
      range.setEnd(later.querySelector("p")!.firstChild!, 2);
      later.getSelection()!.removeAllRanges(); later.getSelection()!.addRange(range);
    });
    act(() => later.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { button: 0, bubbles: true })));
    expect(later.getSelection()!.toString()).toBe("La");
    expect(earlier.getSelection()!.toString()).toBe("Lux");
    expect(gestures).toHaveBeenCalledWith(expect.objectContaining({ document: later,
      details: expect.objectContaining({ text: "casa", lang: "es", sentence: "La casa brilla.",
        locator: expect.objectContaining({ sectionIndex: 1, cfi: "epubcfi(1:casa)", text: expect.objectContaining({ highlight: "casa" }) }) }) }));
    expect(calls.history).toHaveBeenCalledWith(expect.objectContaining({ word: "casa", language: "es" }));
    await paint(); await paint();
    expect(calls.dictionary).toHaveBeenCalledWith("es", ["casa"], expect.any(AbortSignal), undefined, expect.any(Object));
  });
  it("captures text, markup, locator and geometry before a selection listener edits the source DOM", async () => {
    const [earlier, later] = retainedSelections(), gestures = vi.fn(), notifications = vi.fn();
    engine.on("word-gesture", gestures);
    engine.on("selection", selection => {
      if (!selection) return;
      notifications(selection);
      const paragraph = later.querySelector("p")!, text = paragraph.firstChild as Text;
      // This changes the live cloned range itself, unlike replacing Selection.
      text.insertData(5, "nue");
      paragraph.setAttribute("lang", "fr");
      vi.spyOn(Object.getPrototypeOf(later.createRange()), "getBoundingClientRect")
        .mockReturnValue(new DOMRect(80, 90, 100, 110));
      // External selection consumers receive their own mutable locator copy.
      selection.locator.text!.highlight = "listener edit";
      selection.locator.cfi = "listener-cfi";
    });
    act(() => later.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { button: 0, bubbles: true })));
    expect(later.querySelector("p")!.textContent).toBe("La canuesa brilla.");
    expect(later.getSelection()!.getRangeAt(0).toString()).toBe("canuesa");
    expect(earlier.getSelection()!.toString()).toBe("Lux");
    const { details, document: source } = gestures.mock.calls[0][0];
    expect(source).toBe(later);
    expect(details).toMatchObject({ text: "casa", sentence: "La casa brilla.", lang: "es",
      locator: { href: "later", sectionIndex: 1, cfi: "epubcfi(1:casa)", text: { highlight: "casa" } } });
    expect(details.rect.toJSON()).toMatchObject({ left: 420, top: 240, right: 480, bottom: 320 });
    expect(notifications.mock.calls[0][0].rect).toEqual({ left: 420, top: 240, right: 480, bottom: 320 });
    expect(details.locator).not.toBe(notifications.mock.calls[0][0].locator);
    expect(Object.isFrozen(details)).toBe(true); expect(Object.isFrozen(details.locator)).toBe(true);
    expect(Object.isFrozen(details.locator.text)).toBe(true);
    expect(lookupHost.querySelector('[aria-label="Look up casa"]')).not.toBeNull();
    expect(calls.history).toHaveBeenCalledWith(expect.objectContaining({ word: "casa", sentence: "La casa brilla.", language: "es" }));
    await paint(); await paint();
    expect(calls.dictionary).toHaveBeenCalledWith("es", ["casa"], expect.any(AbortSignal), undefined, expect.any(Object));
  });
  it.each(["clear", "destroy", "unload"] as const)("does not publish a captured gesture after a selection listener requests %s", async action => {
    const [earlier, later] = retainedSelections(), gestures = vi.fn();
    engine.on("word-gesture", gestures);
    engine.on("selection", selection => {
      if (!selection) return;
      if (action === "clear") engine.clearSelection();
      else if (action === "destroy") engine.destroy();
      else vi.spyOn(view.renderer, "getContents").mockReturnValue([{ doc: earlier, index: 0 }]);
    });
    act(() => later.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { button: 0, bubbles: true })));
    expect(gestures).not.toHaveBeenCalled();
    expect(lookupHost.querySelector('[role="dialog"]')).toBeNull(); expect(calls.history).not.toHaveBeenCalled();
    await paint(); await paint(); expect(calls.dictionary).not.toHaveBeenCalled();
  });
  it("remembers the later source for host toolbar and host D without falling back after it clears or unloads", async () => {
    const [earlier, later] = retainedSelections();
    later.dispatchEvent(new Event("selectionchange"));
    expect(engine.selectionDetails()?.text).toBe("casa");
    const selectionDetails = vi.spyOn(engine, "selectionDetails");
    const button = lookupHost.querySelector<HTMLButtonElement>('button[aria-label="Look up"]')!;
    act(() => button.click());
    expect(selectionDetails).toHaveBeenLastCalledWith();
    expect(calls.history).toHaveBeenLastCalledWith(expect.objectContaining({ word: "casa", language: "es" }));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true })));
    expect(selectionDetails).toHaveBeenLastCalledWith(undefined);
    expect(lookupHost.querySelector('[aria-label="Look up casa"]')).not.toBeNull();
    await paint(); await paint();
    expect(calls.dictionary).toHaveBeenCalledWith("es", ["casa"], expect.any(AbortSignal), undefined, expect.any(Object));
    later.getSelection()!.removeAllRanges();
    expect(engine.selectionDetails()).toBeNull(); expect(engine.locatorFromSelection()).toBeNull();
    expect(earlier.getSelection()!.toString()).toBe("Lux");
    vi.spyOn(view.renderer, "getContents").mockReturnValue([{ doc: earlier, index: 0 }]);
    expect(engine.selectionDetails(later)).toBeNull(); expect(engine.selectionDetails()).toBeNull();
  });
});
