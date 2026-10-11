import type { PageViewport } from "pdfjs-dist";
import type { PdfSession } from "@/lib/reader/engines/foliate/pdf-session";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfRasterRenderer } from "@/lib/reader/engines/foliate/pdf-raster-renderer";
import { MAX_CANVAS_BYTES } from "@/lib/reader/engines/foliate/canvas-budget";

const signal = () => new AbortController().signal;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
function frame() {
  const replaceChildren = vi.fn();
  const parent = { style: { visibility: "visible" } };
  const doc = {
    defaultView: {
      devicePixelRatio: 3,
      frameElement: { isConnected: true, parentElement: parent },
    },
    querySelector: () => ({ replaceChildren }),
    adoptNode: (canvas: unknown) => canvas,
  } as unknown as Document;
  return { doc, parent, replaceChildren };
}
function harness() {
  const surfaces: {
    width: number;
    height: number;
    style: { width?: string; height?: string };
  }[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = { width: 300, height: 150, style: {} };
      surfaces.push(canvas);
      return canvas;
    },
  });
  const gate = deferred();
  const cancel = vi.fn();
  const release = vi.fn();
  const page = {
    getViewport: ({ scale }: { scale: number }) =>
      ({ width: 600 * scale, height: 800 * scale, scale }) as PageViewport,
    render: vi.fn((_options: unknown) => ({ promise: gate.promise, cancel })),
  };
  const session = {
    acquirePage: vi.fn(async () => ({ page, release })),
  } as unknown as PdfSession;
  return {
    renderer: new PdfRasterRenderer(session),
    surfaces,
    page,
    gate,
    cancel,
    release,
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("PDF raster backing integration", () => {
  it("counts the pending backing before paint completes and uses exact raster scales", async () => {
    const h = harness(),
      f = frame();
    const painted = h.renderer.paint(0, f.doc, 1, signal());
    await tick();
    await tick();
    expect(h.renderer.ledger.count).toBe(1);
    expect(h.renderer.ledger.bytes).toBe(1200 * 1600 * 4);
    expect(h.surfaces[0]).toMatchObject({
      width: 1200,
      height: 1600,
      style: { width: "600px", height: "800px" },
    });
    expect(h.page.render.mock.calls[0][0]).toMatchObject({
      transform: [2, 0, 0, 2, 0, 0],
    });
    expect(f.replaceChildren).not.toHaveBeenCalled();
    h.gate.resolve();
    await painted;
    expect(f.replaceChildren).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
    h.renderer.close();
    expect([
      h.surfaces[0].width,
      h.surfaces[0].height,
      h.renderer.ledger.bytes,
    ]).toEqual([0, 0, 0]);
  });

  it("aborts its pending paint without publishing or destroying another live page", async () => {
    const h = harness(),
      first = frame(),
      second = frame();
    h.gate.resolve();
    await h.renderer.paint(0, first.doc, 1, signal());
    const pending = deferred();
    const pendingCancel = vi.fn();
    h.page.render.mockImplementationOnce(() => ({
      promise: pending.promise,
      cancel: pendingCancel,
    }));
    const owner = new AbortController();
    const secondPaint = h.renderer.paint(1, second.doc, 1, owner.signal);
    const rejected = expect(secondPaint).rejects.toMatchObject({
      name: "AbortError",
    });
    await tick();
    await tick();
    expect(h.renderer.ledger.count).toBe(2);
    owner.abort();
    await rejected;
    expect(pendingCancel).toHaveBeenCalledOnce();
    expect(second.replaceChildren).not.toHaveBeenCalled();
    expect(first.replaceChildren).toHaveBeenCalledOnce();
    expect(h.surfaces[0].width).toBe(1200);
    expect(h.surfaces[1].width).toBe(0);
    pending.resolve();
    h.renderer.close();
  });

  it("retains the outgoing canvas while a replacement fits, and skips identical raster work", async () => {
    const h = harness(),
      f = frame();
    h.gate.resolve();
    await h.renderer.paint(0, f.doc, 1, signal());
    await h.renderer.paint(0, f.doc, 1, signal());
    expect(h.page.render).toHaveBeenCalledOnce();
    const next = deferred();
    h.page.render.mockImplementationOnce(() => ({
      promise: next.promise,
      cancel: vi.fn(),
    }));
    const replacement = h.renderer.paint(0, f.doc, 2, signal());
    await tick();
    await tick();
    expect(h.renderer.ledger.count).toBe(2);
    expect(h.surfaces[0].width).toBe(1200);
    next.resolve();
    await replacement;
    expect(h.renderer.ledger.count).toBe(1);
    expect(h.surfaces[0].width).toBe(0);
    expect(h.surfaces[1].width).toBe(2400);
    h.renderer.close();
  });

  it("evicts hidden page backing before allocating a fourth single-page surface", async () => {
    const h = harness();
    h.gate.resolve();
    const frames = [frame(), frame(), frame(), frame()];
    for (let index = 0; index < 3; index++)
      await h.renderer.paint(index, frames[index].doc, 1, signal());
    frames[0].parent.style.visibility = "hidden";
    await h.renderer.paint(3, frames[3].doc, 1, signal());
    expect(h.renderer.ledger.count).toBe(3);
    expect(h.surfaces[0].width).toBe(0);
    expect(h.surfaces.slice(1).every((canvas) => canvas.width > 0)).toBe(true);
    h.renderer.releaseDocument(frames[1].doc);
    expect(h.renderer.ledger.count).toBe(2);
    h.renderer.close();
  });

  it("never exceeds the aggregate cap at extreme zoom and retires a removed frame during paint", async () => {
    const h = harness(),
      f = frame();
    const owner = new AbortController();
    const paint = h.renderer.paint(0, f.doc, 10000, owner.signal);
    const rejected = expect(paint).rejects.toMatchObject({
      name: "AbortError",
    });
    await tick();
    await tick();
    expect(h.renderer.ledger.bytes).toBeLessThanOrEqual(MAX_CANVAS_BYTES);
    h.renderer.releaseDocument(f.doc);
    await rejected;
    h.gate.resolve();
    expect(f.replaceChildren).not.toHaveBeenCalled();
    expect(h.renderer.ledger.bytes).toBe(0);
    h.renderer.close();
    await expect(h.renderer.paint(0, f.doc, 1, signal())).rejects.toThrow(
      /closed/,
    );
  });
});
