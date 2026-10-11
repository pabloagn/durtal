// @vitest-environment happy-dom
// Structural selection/viewport fixture; native PDF geometry remains a native gate.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { FoliateBook } from "@/lib/reader/engines/foliate/foliate";
import type { ReaderEngine } from "@/lib/reader/engine";
const fixture = vi.hoisted(() => ({ book: null as FoliateBook | null }));
vi.mock("pdfjs-dist", () => ({}));
vi.mock("@/vendor/foliate-js/view.js", () => ({}));
vi.mock("@/lib/reader/engines/foliate/pdf-session", () => ({ openPdfSession: async () => ({
  failure: new Promise<never>(() => {}), signal: new AbortController().signal, destroy: async () => {},
}) }));
vi.mock("@/lib/reader/engines/foliate/pdf-book", () => ({ makePdfBook: async () => fixture.book }));
vi.mock("@/lib/reader/engines/foliate/pdf-text-provider", () => ({ bindPdfTextProvider: () => ({
  pdfPageText: async () => ({ fileHash: "a".repeat(64), pageIndex: 0, pageLabel: "1", text: "Selected passage." }),
  locatorForPdfTextOffsets: async () => null,
}) }));
import { createFoliateEngine } from "@/lib/reader/engines/foliate/engine";
import { presentationFrom, resolveThemeColors } from "@/lib/reader/presentation";
import { READER_DEFAULTS } from "@/lib/reader/settings-cookie";
class PdfSelectionView extends HTMLElement {
  frame = document.createElement("iframe");
  renderer = Object.assign(document.createElement("div"), {
    atEnd: false,
    getContents: () => [{ doc: this.frame.contentDocument, index: 0 }],
  });
  async open() {
    this.append(this.renderer); this.renderer.append(this.frame);
    const doc = this.frame.contentDocument;
    if (!doc) throw new Error("Selection fixture document missing");
    doc.body.innerHTML = '<canvas id="canvas"></canvas><div class="textLayer"><p>Before. Selected passage. After.</p></div>';
    this.dispatchEvent(new CustomEvent("load", { detail: { doc, index: 0 } }));
  }
  async init() {
    this.dispatchEvent(new CustomEvent("relocate", { detail: {
      index: 0, reason: "page", fraction: 0, sectionFraction: 0, cfi: "", range: null,
    } }));
  }
  getSectionFractions() { return [0, 1]; }
  getProgressOf() { return { tocItem: { label: "Chapter" }, pageItem: { label: "1" } }; }
  getCFI() { return ""; }
  close() {}
}
let host: HTMLElement, engine: ReaderEngine, view: PdfSelectionView;
beforeAll(() => {
  if (!customElements.get("foliate-view")) customElements.define("foliate-view", PdfSelectionView);
});
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
  fixture.book = {
    sections: [{ id: 0, size: 1000 }], metadata: { title: "PDF" }, rendition: { layout: "pre-paginated" },
    pageList: [{ label: "1", href: "0" }], resolveHref: href => ({ index: Number(href) }),
    pdfViewport: () => ({ height: 100, convertToPdfPoint: (x, y) => [x, y], convertToViewportRectangle: rect => rect }),
  };
  host = document.createElement("div"); document.body.append(host); engine = createFoliateEngine();
  await engine.open({ ebookId: "11111111-1111-4111-8111-111111111111", fileId: "22222222-2222-4222-8222-222222222222",
    format: "pdf", size: 1000, sha256: "a".repeat(64), url: "/unused", fallbackUrl: "/unused" },
    { container: host, presentation: presentationFrom(READER_DEFAULTS, resolveThemeColors(), "") });
  const element = host.querySelector("foliate-view");
  if (!(element instanceof PdfSelectionView)) throw new Error("Selection fixture view missing");
  view = element;
});
afterEach(() => { engine.destroy(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("keeps a complete PDF passage and rejects a selection whose document cannot supply its quote", () => {
  const doc = view.frame.contentDocument;
  if (!doc) throw new Error("Selection fixture document missing");
  const text = doc.querySelector("p")?.firstChild, selection = doc.getSelection();
  if (!text || !selection) throw new Error("Selection fixture passage missing");
  const range = doc.createRange(); range.setStart(text, 8); range.setEnd(text, 25);
  const rects = range.getClientRects(), rect = new DOMRect(10, 20, 80, 10);
  Object.defineProperties(rects, {
    0: { value: rect }, length: { value: 1 },
    item: { value: (index: number) => index === 0 ? rect : null },
    [Symbol.iterator]: { value: () => [rect].values() },
  });
  // Native cloned ranges measure the same document geometry.
  vi.spyOn(Object.getPrototypeOf(range), "getClientRects").mockReturnValue(rects);
  selection.addRange(range);
  expect(engine.locatorFromSelection()).toMatchObject({
    fileHash: "a".repeat(64), pdf: { page: 1, rects: [[10, 20, 90, 30]] },
    text: { highlight: "Selected passage.", before: "Before. ", after: " After." },
  });
  selection.removeAllRanges();
  const orphan = doc.createTextNode("Still selected"); doc.head.append(orphan); doc.body.remove();
  const unavailable = doc.createRange(); unavailable.selectNodeContents(orphan); selection.addRange(unavailable);
  expect(selection.toString()).toBe("Still selected");
  expect(engine.locatorFromSelection()).toBeNull();
});
