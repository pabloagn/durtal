// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageViewport } from "pdfjs-dist";
import type { PdfSession } from "@/lib/reader/engines/foliate/pdf-session";
import { makePdfBook, type PdfFixedPageSource } from "@/lib/reader/engines/foliate/pdf-book";
import { forPdfOwner } from "@/lib/reader/engines/foliate/pdf-lifetime";
import { followPdfFrameRender, type PdfFrameRender } from "@/lib/reader/engines/foliate/pdf-frame-handoff";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Gate = ReturnType<typeof deferred<void>>;
const fixture = vi.hoisted(() => ({
  paints: [] as { scale: number; owner: AbortSignal; gate: Gate }[],
  layers: [] as { gate: Gate; cancel: ReturnType<typeof vi.fn> }[],
}));
vi.mock("@/vendor/foliate-js/pdf.js", () => ({ parsePDFMetadata: () => ({ title: "Owned PDF" }) }));
vi.mock("@/lib/reader/engines/foliate/pdf-raster-renderer", () => ({
  PdfRasterRenderer: class {
    async paint(_index: number, _doc: Document, scale: number, owner: AbortSignal) {
      const gate = deferred<void>();
      fixture.paints.push({ scale, owner, gate });
      await forPdfOwner(gate.promise, owner);
      return viewport(scale);
    }
    setTwoPages() {}
    releaseDocument() {}
    close() {}
  },
}));
function viewport(scale: number): PageViewport {
  return { width: 100 * scale, height: 200 * scale, scale, rotation: 0, userUnit: 1,
    convertToPdfPoint: (x: number, y: number) => [x / scale, y / scale],
    convertToViewportPoint: (x: number, y: number) => [x * scale, y * scale],
  } as PageViewport;
}
// Controlled raster and TextLayer producers exercise the production onZoom
// lifecycle. They do not claim native glyph/geometry or network certification.
const api = {
  OPS: {},
  TextLayer: class {
    gate = deferred<void>(); cancel = vi.fn();
    constructor() { fixture.layers.push(this); }
    render() { return this.gate.promise; }
  },
} as unknown as Parameters<typeof makePdfBook>[1];
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function harness() {
  const owner = new AbortController();
  const release = vi.fn(), destroy = vi.fn(async () => {});
  const consumers: AbortSignal[] = [];
  const page = { getViewport: ({ scale }: { scale: number }) => viewport(scale),
    getAnnotations: async () => [], getOperatorList: async () => ({ fnArray: [], argsArray: [] }), view: [0,0,100,200] };
  const session = {
    signal: owner.signal, pageCount: 1, destroy,
    document: { getPageLabels: async () => null, getMetadata: async () => ({ info: {} }),
      getViewerPreferences: async () => null, getOutline: async () => null },
    acquirePage: async (_index: number, signal: AbortSignal) => {
      consumers.push(signal); return forPdfOwner(Promise.resolve({ page, release }), signal);
    },
    pageTextContent: async (_index: number, signal: AbortSignal) => {
      consumers.push(signal); return forPdfOwner(Promise.resolve({ items: [], styles: {} }), signal);
    },
  } as unknown as PdfSession;
  const book = await makePdfBook(session, api, "");
  const source = await book.sections[0].load!() as unknown as PdfFixedPageSource;
  const host = document.createElement("iframe"); document.body.append(host);
  const doc = host.contentDocument!;
  // Happy DOM does not wire this native back-reference; model only ownership,
  // keeping mounted state tied to the actual host rather than geometry mocks.
  Object.defineProperty(doc.defaultView!, "frameElement", { configurable: true, value: host });
  doc.body.innerHTML = '<div id="pdf-page"><div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div></div>';
  const painted = vi.fn(); doc.addEventListener("durtal-pdf-painted", painted);
  return { owner, book, source, host, doc, painted, destroy, consumers };
}
async function finishRaster(index: number) { fixture.paints[index].gate.resolve(); await flush(); }
async function finishText(index: number) { fixture.layers[index].gate.resolve(); await flush(); }
beforeEach(() => { fixture.paints.length = 0; fixture.layers.length = 0; });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("production PDF zoom generation handoff", () => {
  it("keeps initial/open wait pending through resize until replacement raster AND text complete", async () => {
    const h = await harness(); let admitted = false;
    const first = h.source.onZoom({ doc: h.doc, scale: 1 }).then(size => { admitted = true; return size; });
    await flush(); expect(fixture.paints).toHaveLength(1);
    const next = h.source.onZoom({ doc: h.doc, scale: 2 }); await flush();
    expect(fixture.paints[0].owner.aborted).toBe(true);
    expect(h.owner.signal.aborted).toBe(false); expect(h.destroy).not.toHaveBeenCalled();
    expect(admitted).toBe(false); expect(h.painted).not.toHaveBeenCalled();
    await finishRaster(1); expect(fixture.layers).toHaveLength(1);
    expect(admitted).toBe(false); expect(h.book.pdfViewport!(h.doc)).toBeNull();
    await finishText(0);
    expect(await first).toEqual({ width: 100, height: 200 }); expect(await next).toEqual(await first);
    expect(h.painted).toHaveBeenCalledOnce();
    expect(h.doc.querySelector<HTMLElement>("#pdf-page")!.style.width).toBe("200px");
    expect(h.book.pdfViewport!(h.doc)!.height).toBe(400);
    fixture.paints[0].gate.resolve(); await flush(); expect(h.painted).toHaveBeenCalledOnce();
    expect(h.consumers.every(signal => signal === h.owner.signal || !signal.aborted)).toBe(true);
  });
  it("follows several replacements during TextLayer work and publishes only the latest frame", async () => {
    const h = await harness();
    const first = h.source.onZoom({ doc: h.doc, scale: 1 }); await flush(); await finishRaster(0);
    const second = h.source.onZoom({ doc: h.doc, scale: 2 }); await flush(); await finishRaster(1);
    const third = h.source.onZoom({ doc: h.doc, scale: 3 }); await flush();
    expect(fixture.layers[0].cancel).toHaveBeenCalled(); expect(fixture.layers[1].cancel).toHaveBeenCalled();
    await finishRaster(2); await finishText(2);
    expect(await Promise.all([first,second,third])).toEqual(Array(3).fill({ width: 100, height: 200 }));
    expect(h.painted).toHaveBeenCalledOnce(); expect(h.book.pdfViewport!(h.doc)!.height).toBe(600);
    await finishText(0); await finishText(1); expect(h.painted).toHaveBeenCalledOnce();
  });
  it.each(["raster", "text"])("delivers latest real %s failure to all original waiters", async stage => {
    const h = await harness(); const failure = new Error("current PDF render failed");
    const first = h.source.onZoom({ doc: h.doc, scale: 1 }); await flush();
    const next = h.source.onZoom({ doc: h.doc, scale: 2 });
    const firstFailure = expect(first).rejects.toBe(failure), nextFailure = expect(next).rejects.toBe(failure);
    await flush();
    if (stage === "raster") fixture.paints[1].gate.reject(failure);
    else { await finishRaster(1); fixture.layers[0].gate.reject(failure); }
    await Promise.all([firstFailure,nextFailure]);
    expect(h.painted).not.toHaveBeenCalled(); expect(h.book.pdfViewport!(h.doc)).toBeNull();
    expect(h.owner.signal.aborted).toBe(false);
  });
  it("rejects session lifetime abort even with a successor and cannot publish its later completion", async () => {
    const h = await harness();
    const first = h.source.onZoom({ doc: h.doc, scale: 1 }); await flush();
    const next = h.source.onZoom({ doc: h.doc, scale: 2 }); await flush();
    const reason = new DOMException("session retired", "AbortError");
    const failures = [expect(first).rejects.toBe(reason), expect(next).rejects.toBe(reason)];
    h.owner.abort(reason);
    await Promise.all(failures);
    fixture.paints[1].gate.resolve(); await flush(); expect(h.painted).not.toHaveBeenCalled();
  });
  it("does not hand off a released document to an unrelated new render epoch", async () => {
    const h = await harness();
    const first = h.source.onZoom({ doc: h.doc, scale: 1 }); await flush();
    const failure = expect(first).rejects.toHaveProperty("name", "AbortError");
    h.source.onDestroy(h.doc);
    const next = h.source.onZoom({ doc: h.doc, scale: 2 }); await flush(); await failure;
    await finishRaster(1); await finishText(0); await next;
    expect(h.painted).toHaveBeenCalledOnce(); expect(h.owner.signal.aborted).toBe(false);
  });
  it("rejects a detached document before text or publication even without onDestroy", async () => {
    const h = await harness(); const work = h.source.onZoom({ doc: h.doc, scale: 1 }); await flush();
    const failure = expect(work).rejects.toHaveProperty("name", "AbortError");
    h.host.remove(); await finishRaster(0); await failure;
    expect(fixture.layers).toHaveLength(0); expect(h.painted).not.toHaveBeenCalled();
    expect(h.book.pdfViewport!(h.doc)).toBeNull();
  });
  it("isolates resize cancellation from another document sharing the same session", async () => {
    const h = await harness();
    const host = document.createElement("iframe"); document.body.append(host);
    const doc = host.contentDocument!;
    Object.defineProperty(doc.defaultView!, "frameElement", { configurable: true, value: host });
    doc.body.innerHTML = h.doc.body.innerHTML;
    const otherPainted = vi.fn(); doc.addEventListener("durtal-pdf-painted", otherPainted);
    const first = h.source.onZoom({ doc: h.doc, scale: 1 }); await flush();
    const other = h.source.onZoom({ doc, scale: 2 }); await flush();
    const replacement = h.source.onZoom({ doc: h.doc, scale: 3 }); await flush();
    expect(fixture.paints.map(paint => paint.owner.aborted)).toEqual([true,false,false]);
    expect(h.owner.signal.aborted).toBe(false); expect(h.destroy).not.toHaveBeenCalled();
    await finishRaster(1); await finishText(0); await other;
    expect(otherPainted).toHaveBeenCalledOnce(); expect(h.painted).not.toHaveBeenCalled();
    await finishRaster(2); await finishText(1); await Promise.all([first,replacement]);
    expect(h.painted).toHaveBeenCalledOnce(); expect(otherPainted).toHaveBeenCalledOnce();
  });
  it("rejects book destruction independently of local resize handoff", async () => {
    const h = await harness();
    const first = h.source.onZoom({ doc: h.doc, scale: 1 }); await flush();
    const next = h.source.onZoom({ doc: h.doc, scale: 2 }); await flush();
    const failures = [expect(first).rejects.toHaveProperty("name", "AbortError"), expect(next).rejects.toHaveProperty("name", "AbortError")];
    h.book.destroy!(); await Promise.all(failures);
    expect(h.destroy).toHaveBeenCalledOnce(); expect(h.owner.signal.aborted).toBe(false);
    fixture.paints[1].gate.resolve(); await flush(); expect(h.painted).not.toHaveBeenCalled();
  });
  it("preserves asynchronous rejection when zoom starts after session retirement", async () => {
    const h = await harness(), reason = new DOMException("closed session", "AbortError");
    h.owner.abort(reason);
    let work!: ReturnType<PdfFixedPageSource["onZoom"]>;
    expect(() => { work = h.source.onZoom({ doc: h.doc, scale: 1 }); }).not.toThrow();
    await expect(work).rejects.toBe(reason);
    expect(fixture.paints).toHaveLength(0); expect(h.painted).not.toHaveBeenCalled();
  });

});

describe("exact PDF frame cancellation admission", () => {
  it("does not swallow an unrelated AbortError even if the old owner was cancelled", async () => {
    const lifetime = new AbortController(), owner = new AbortController();
    const gate = deferred<number>(), unrelated = new DOMException("real failure", "AbortError");
    const next: PdfFrameRender<number> = { owner: new AbortController(), result: Promise.resolve(2) };
    const first: PdfFrameRender<number> = { owner, result: gate.promise, successor: next };
    const waiter = followPdfFrameRender(first, () => next, lifetime.signal, () => true);
    const failure = expect(waiter).rejects.toBe(unrelated);
    owner.abort(); gate.reject(unrelated); await failure;
  });
  it("follows a completed result superseded before delivery, without admitting stale dimensions", async () => {
    const lifetime = new AbortController(), owner = new AbortController();
    const first: PdfFrameRender<number> = { owner, result: Promise.resolve(1) };
    const next: PdfFrameRender<number> = { owner: new AbortController(), result: Promise.resolve(2) };
    let current = first;
    const waiter = followPdfFrameRender(first, () => current, lifetime.signal, () => true);
    first.successor = next; current = next; owner.abort();
    expect(await waiter).toBe(2);
  });
});
