// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoliateBook, FoliateProgress } from "@/lib/reader/engines/foliate/foliate";
import type { ReaderEngine } from "@/lib/reader/engine";
// A structural view stands in for foliate: these cases pin what the engine
// asks the renderer for on a page turn, not how far the paginator scrolls
const fixture = vi.hoisted(() => ({ book: null as FoliateBook | null }));
vi.mock("pdfjs-dist", () => ({}));
vi.mock("@/vendor/foliate-js/view.js", () => ({}));
vi.mock("@/lib/reader/engines/foliate/pdf-session", () => ({ openPdfSession: async () => ({ failure: new Promise<never>(() => {}), signal: new AbortController().signal, destroy: async () => {} }) }));
vi.mock("@/lib/reader/engines/foliate/pdf-book", () => ({ makePdfBook: async () => fixture.book }));
vi.mock("@/lib/reader/engines/foliate/pdf-text-provider", () => ({ bindPdfTextProvider: () => ({ pdfPageText: async () => null, locatorForPdfTextOffsets: async () => null }) }));
import { createFoliateEngine } from "@/lib/reader/engines/foliate/engine";
import { presentationFrom, resolveThemeColors } from "@/lib/reader/presentation";
import { READER_DEFAULTS } from "@/lib/reader/settings-cookie";
class ScrollView extends HTMLElement {
  frame = document.createElement("iframe");
  book = fixture.book!;
  renderer = Object.assign(document.createElement("div"), {
    atEnd: false, scrolled: false, size: 800,
    getContents: () => [{ doc: this.frame.contentDocument!, index: 0 }],
    goTo: async () => {},
  });
  turns: [string, number | undefined][] = [];
  lastLocation: FoliateProgress | null = null;
  async open() { this.append(this.renderer); this.renderer.append(this.frame); this.frame.contentDocument!.body.innerHTML = "<p>Text</p>"; }
  async init() { this.lastLocation = { index: 0, reason: "page", fraction: 0, sectionFraction: 0, cfi: "", range: null }; this.dispatchEvent(new CustomEvent("relocate", { detail: this.lastLocation })); }
  async next(distance?: number) { this.turns.push(["next", distance]); }
  async prev(distance?: number) { this.turns.push(["prev", distance]); }
  async goLeft() { this.turns.push(["goLeft", undefined]); }
  async goRight() { this.turns.push(["goRight", undefined]); }
  getSectionFractions() { return [0, 1]; }
  resolveNavigation(target: unknown) { return { index: Number(target) }; }
  getCFI() { return ""; }
  close() {}
}
let host: HTMLElement, engine: ReaderEngine, view: ScrollView;
const open = async (dir?: string) => {
  fixture.book = { dir, sections: [{ id: 0, size: 1500 }], metadata: { title: "Book" }, rendition: { layout: "pre-paginated" }, pageList: [], resolveHref: href => ({ index: Number(href) }), pdfViewport: () => ({ height: 100, convertToPdfPoint: (x, y) => [x, y], convertToViewportRectangle: rect => rect }) } as FoliateBook;
  host = document.createElement("div"); document.body.append(host); engine = createFoliateEngine();
  await engine.open({ ebookId: "book", fileId: "file", format: "pdf", size: 2000, sha256: "a".repeat(64), url: "/unused", fallbackUrl: "/unused" }, { container: host, presentation: presentationFrom(READER_DEFAULTS, resolveThemeColors(), "") });
  view = host.querySelector("foliate-view") as ScrollView;
  view.frame.contentDocument!.body.style.lineHeight = "30px";
};
beforeAll(() => { if (!customElements.get("foliate-view")) customElements.define("foliate-view", ScrollView); });
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 }))); });
afterEach(() => { engine.destroy(); host.remove(); vi.unstubAllGlobals(); });
describe("a page turn in the scroll flow (SLN-674)", () => {
  it("scrolls a screen less one line, so the last line read stays in view", async () => {
    await open(); view.renderer.scrolled = true;
    await engine.next(); await engine.prev();
    expect(view.turns).toEqual([["next", 770], ["prev", 770]]);
  });
  it("follows the book's direction for left and right", async () => {
    await open(); view.renderer.scrolled = true;
    await engine.goRight(); await engine.goLeft();
    expect(view.turns).toEqual([["next", 770], ["prev", 770]]);
  });
  it("turns the other way in a right-to-left book", async () => {
    await open("rtl"); view.renderer.scrolled = true;
    await engine.goRight(); await engine.goLeft();
    expect(view.turns).toEqual([["prev", 770], ["next", 770]]);
  });
  it("keeps the line clear of what covers the screen's edges", async () => {
    await open(); view.renderer.scrolled = true;
    engine.setCovered?.({ top: 24, bottom: 60 });
    await engine.next();
    expect(view.turns).toEqual([["next", 686]]);
  });
  it("reads the line between the bars at the press, once, and lands it clear of what stays", async () => {
    await open(); view.renderer.scrolled = true;
    engine.setCovered?.({ top: 24, bottom: 60 }, { top: 80, bottom: 100 });
    await engine.next();
    engine.setCovered?.({ top: 24, bottom: 60 }, { top: 80, bottom: 100 });
    await engine.prev();
    await engine.next();
    expect(view.turns).toEqual([["next", 646], ["prev", 630], ["next", 686]]);
  });
  it("ignores covers that would leave less than half the screen", async () => {
    await open(); view.renderer.scrolled = true;
    engine.setCovered?.({ top: 300, bottom: 300 });
    await engine.next();
    expect(view.turns).toEqual([["next", 770]]);
  });
  it("never keeps less than half a screen of new text", async () => {
    await open(); view.renderer.scrolled = true; view.renderer.size = 40;
    await engine.next();
    expect(view.turns).toEqual([["next", 20]]);
  });
  it("turns whole pages when the book is paginated", async () => {
    await open();
    await engine.next(); await engine.goLeft();
    expect(view.turns).toEqual([["next", undefined], ["goLeft", undefined]]);
  });
});
