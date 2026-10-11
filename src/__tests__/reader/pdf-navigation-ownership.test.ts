// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoliateBook, FoliateProgress } from "@/lib/reader/engines/foliate/foliate";
import type { DurtalLocator, ReaderEngine, EngineEvents } from "@/lib/reader/engine";
import { FixedScrollOwnership } from "@/vendor/foliate-js/fixed-scroll-ownership.js";
// Structural frame/session fixtures exercise production adapter and scroll guard
// ownership. They do not certify native PDF glyph/crop geometry or scrolling.
const fixture = vi.hoisted(() => ({ book: null as FoliateBook | null }));
vi.mock("pdfjs-dist", () => ({}));
vi.mock("@/vendor/foliate-js/view.js", () => ({}));
vi.mock("@/lib/reader/engines/foliate/pdf-session", () => ({ openPdfSession: async () => ({ failure: new Promise<never>(() => {}), signal: new AbortController().signal, destroy: async () => {} }) }));
vi.mock("@/lib/reader/engines/foliate/pdf-book", () => ({ makePdfBook: async () => fixture.book }));
vi.mock("@/lib/reader/engines/foliate/pdf-text-provider", () => ({ bindPdfTextProvider: () => ({ pdfPageText: async () => ({ fileHash: "a".repeat(64), pageIndex: 0, pageLabel: "1", text: "First sentence. Second sentence." }), locatorForPdfTextOffsets: async () => null }) }));
import { createReaderNavigation } from "@/lib/reader/navigation";
import { createFoliateEngine } from "@/lib/reader/engines/foliate/engine";
import { presentationFrom, resolveThemeColors } from "@/lib/reader/presentation";
import { READER_DEFAULTS } from "@/lib/reader/settings-cookie";
class PdfView extends HTMLElement {
  frame = document.createElement("iframe"); index = 0; position = { left: 0, top: 0 };
  ownership = new FixedScrollOwnership();
  timers = new Set<ReturnType<typeof setTimeout>>();
  renderer = Object.assign(document.createElement("div"),{
    atEnd: false, getContents: () => [{ doc: this.frame.contentDocument!, index: this.index }],
    goTo: async ({ index }: { index: number }) => { this.index = index; this.position.top = index*100; this.ownership.own(this.position.left,this.position.top); this.report("navigation"); },
    showPageRect: () => { this.position.top += 10; this.ownership.own(this.position.left,this.position.top); const timer = setTimeout(() => { this.timers.delete(timer); this.settle(); },150); this.timers.add(timer); return true; },
  });
  lastLocation: FoliateProgress | null = null;
  async open() { this.append(this.renderer); this.renderer.append(this.frame); this.frame.contentDocument!.body.innerHTML = "<p>PDF frame fixture</p>"; this.dispatchEvent(new CustomEvent("load",{ detail: { doc: this.frame.contentDocument!, index: 0 } })); }
  report(reason: string) { this.lastLocation = { index: this.index, reason, fraction: this.index/2, sectionFraction: 0, cfi: "", range: null }; this.dispatchEvent(new CustomEvent("relocate",{ detail: this.lastLocation })); }
  settle() { if (!this.ownership.settle(this.position.left,this.position.top)) this.report("scroll"); }
  async init() { this.report("page"); }
  getSectionFractions() { return [0,.5,1]; }
  resolveNavigation(target: unknown) { return { index: Number(target) }; }
  getCFI() { return ""; }
  close() { for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); this.ownership.interrupt(); }
}
const hash = "a".repeat(64);
const passage = (y = 20): DurtalLocator => ({ v: 1, fileHash: hash, href: "0", sectionIndex: 0, progression: .1, totalProgression: .1, pdf: { page: 1, rects: [[10,y,100,y+10]] }, text: { highlight: y === 20 ? "First sentence." : "Second sentence." } });
let host: HTMLElement, engine: ReaderEngine, view: PdfView;
beforeAll(() => { if (!customElements.get("foliate-view")) customElements.define("foliate-view",PdfView); });
beforeEach(async () => {
  vi.stubGlobal("fetch",vi.fn(async () => new Response("",{ status: 200 })));
  fixture.book = { sections: [{ id: 0, size: 1500 },{ id: 1, size: 1500 }], metadata: { title: "PDF" }, rendition: { layout: "pre-paginated" }, pageList: [{ label: "1", href: "0" },{ label: "2", href: "1" }], resolveHref: href => ({ index: Number(href) }), pdfViewport: () => ({ height: 100, convertToPdfPoint: (x,y) => [x,y], convertToViewportRectangle: rect => rect }) };
  host = document.createElement("div"); document.body.append(host); engine = createFoliateEngine();
  await engine.open({ ebookId: "book", fileId: "pdf", format: "pdf", size: 2000, sha256: hash, url: "/unused", fallbackUrl: "/unused" },{ container: host, presentation: presentationFrom(READER_DEFAULTS,resolveThemeColors(),"") });
  view = host.querySelector("foliate-view") as PdfView;
});
afterEach(() => { engine.destroy(); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("production PDF navigation ownership", () => {
  it.each([{ href: "0" },{ page: "1" },{ fraction: .01 },{ location: 1 }])("drops stale passage rectangles for same-page %j commands", async target => {
    await engine.goTo(passage()); expect(engine.currentLocator()?.pdf?.rects).toEqual(passage().pdf!.rects);
    await engine.goTo(target); expect(engine.currentLocator()?.pdf?.page).toBe(1); expect(engine.currentLocator()?.pdf?.rects).toBeUndefined();
  });
  it("keeps distinct same-page passages and admits recovery only for its own locator", async () => {
    await engine.goTo(passage()); await engine.goTo(passage(40)); expect(engine.currentLocator()?.pdf?.rects).toEqual(passage(40).pdf!.rects);
    const owner = new AbortController();
    vi.spyOn(view.renderer,"goTo").mockImplementationOnce(async () => { owner.abort(); view.report("navigation"); });
    await expect(engine.goTo(passage(),{ id: 2, signal: owner.signal, origin: "speech" })).rejects.toHaveProperty("name","AbortError");
    view.report("layout"); expect(engine.currentLocator()?.pdf?.rects).toBeUndefined();
    await engine.goTo(passage(40),{ id: 3, signal: new AbortController().signal, origin: "layout" });
    expect(engine.currentLocator()?.pdf?.rects).toEqual(passage(40).pdf!.rects);
  });
  it("keeps delayed speech scroll out of human publication and admits real user takeover", async () => {
    vi.useFakeTimers();
    const events: EngineEvents["relocate"][] = [], commits: EngineEvents["relocate"][] = [];
    const humanPace = vi.fn(), trackerActivity = vi.fn(), trackerEnd = vi.fn(), beforeHuman = vi.fn();
    // Publication boundary probes mirror the mounted reader's origin gate; they
    // do not mount the tracker or certify native frame/geometry behavior.
    const navigation = createReaderNavigation({ engine, paint: async () => {}, beforeHuman, commit: event => {
      commits.push(event);
      if (event.reason === "layout" || (event.origin && event.origin !== "human")) return;
      humanPace(event); if (event.activity) trackerActivity(event.activity); if (event.atEnd) trackerEnd();
    } });
    const off = engine.on("relocate",event => { events.push(event); navigation.relocate(event); });
    try {
      view.report("layout"); navigation.start(events.at(-1)!); events.length = 0;
      await navigation.speechTo(passage());
      expect(commits).toHaveLength(1); expect(commits[0]).toMatchObject({ origin: "speech", atEnd: false });
      expect(commits[0].activity).toBeUndefined(); expect(beforeHuman).not.toHaveBeenCalled();
      const arrivals = events.length; await vi.advanceTimersByTimeAsync(151);
      expect(events).toHaveLength(arrivals); expect(commits).toHaveLength(1);
      expect(engine.currentLocator()?.pdf?.rects).toEqual(passage().pdf!.rects);
      expect(events.every(event => event.origin === "speech" && !event.activity && !event.atEnd)).toBe(true);
      expect(humanPace).not.toHaveBeenCalled(); expect(trackerActivity).not.toHaveBeenCalled(); expect(trackerEnd).not.toHaveBeenCalled();
      view.ownership.interrupt(); view.position.top += 5; view.settle();
      await vi.advanceTimersByTimeAsync(0);
      expect(events.at(-1)?.origin).toBe("human"); expect(events.at(-1)?.activity).toBe("scroll");
      expect(engine.currentLocator()?.pdf?.rects).toBeUndefined();
      expect(commits).toHaveLength(2); expect(humanPace).toHaveBeenCalledOnce(); expect(trackerActivity).toHaveBeenCalledExactlyOnceWith("scroll"); expect(trackerEnd).not.toHaveBeenCalled();
    } finally { off(); navigation.destroy(); }
  });
  it("allows user takeover at the same coordinates and rejects displaced ownership", () => {
    const guard = new FixedScrollOwnership(); guard.own(-20,10); expect(guard.settle(-20,10)).toBe(true);
    guard.own(-20,10); guard.interrupt(); expect(guard.settle(-20,10)).toBe(false);
    guard.own(-20,10); expect(guard.settle(-20,11)).toBe(false); expect(guard.settle(-20,10)).toBe(false);
  });
});
