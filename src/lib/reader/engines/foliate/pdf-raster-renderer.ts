import type { PageViewport } from "pdfjs-dist";
import { CanvasLedger, type CanvasLease } from "./canvas-ledger";
import { forPdfOwner } from "./pdf-lifetime";
import type { PdfSession } from "./pdf-session";

interface FramePaint {
  live?: CanvasLease;
  pending?: CanvasLease;
  owner: AbortController;
  signature?: string;
}

/** One opened PDF's page backing surfaces, including visible/cache/pending work. */
export class PdfRasterRenderer {
  readonly ledger = new CanvasLedger();
  #session: PdfSession;
  #frames = new Map<Document, FramePaint>();
  #closed = false;

  constructor(session: PdfSession) {
    this.#session = session;
  }

  setTwoPages(twoPages: boolean) {
    const limit = twoPages ? 4 : 3;
    this.#evictHidden(undefined, limit);
    // A mode change can leave two visible pages briefly alive until regroup.
    // Current surfaces are retained; reducing the cap waits for owned frames.
    if (this.ledger.count > limit)
      throw new Error(
        "Release outgoing PDF frames before changing spread mode",
      );
    this.ledger.setTwoPages(twoPages);
  }

  #evictHidden(current?: Document, targetCount = this.ledger.count - 1) {
    for (const [doc, frame] of this.#frames) {
      if (this.ledger.count <= targetCount) break;
      if (doc === current) continue;
      const element = doc.defaultView?.frameElement;
      const hidden =
        !element?.isConnected ||
        element.parentElement?.style.visibility === "hidden";
      if (!hidden) continue;
      frame.owner.abort();
      frame.pending?.release();
      frame.live?.release();
      frame.pending = undefined;
      frame.live = undefined;
      frame.signature = undefined;
    }
  }

  /** Return a viewport only after this owned raster is painted and adopted. */
  async paint(
    pageIndex: number,
    doc: Document,
    scale: number,
    owner: AbortSignal,
  ): Promise<PageViewport> {
    if (this.#closed) throw new Error("PDF raster renderer is closed");
    owner.throwIfAborted();
    const previous = this.#frames.get(doc);
    previous?.owner.abort();
    previous?.pending?.release();
    const frame: FramePaint = {
      live: previous?.live,
      owner: new AbortController(),
    };
    this.#frames.delete(doc);
    this.#frames.set(doc, frame);
    const signal = AbortSignal.any([owner, frame.owner.signal]);
    const pageLease = await this.#session.acquirePage(pageIndex, signal);
    let reservation: CanvasLease | undefined;
    const abort = () => reservation?.release();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const viewport = pageLease.page.getViewport({ scale });
      const dpr =
        doc.defaultView?.devicePixelRatio || globalThis.devicePixelRatio || 1;
      const signature = [pageIndex, viewport.width, viewport.height, dpr].join(
        ":",
      );
      if (previous?.signature === signature && frame.live?.active) {
        frame.signature = signature;
        return viewport;
      }
      const input = {
        pageCssWidth: viewport.width,
        pageCssHeight: viewport.height,
        devicePixelRatio: dpr,
      };
      let next = this.ledger.reserve(input);
      if (!next) {
        this.#evictHidden(doc);
        next = this.ledger.reserve(input);
      }
      if (!next) {
        // Keeping the outgoing surface can exhaust the aggregate budget.
        // Drop its backing before replacing it rather than over-allocate.
        frame.live?.release();
        frame.live = undefined;
        next = this.ledger.reserve(input);
      }
      if (!next) throw new Error("PDF page backing budget is exhausted");
      reservation = next;
      frame.pending = next;
      const canvas = next.allocate(() => document.createElement("canvas"));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const task = pageLease.page.render({
        canvas,
        viewport,
        transform: [next.plan.scaleX, 0, 0, next.plan.scaleY, 0, 0],
      });
      next.ownPaint(task);
      await forPdfOwner(task.promise, signal);
      signal.throwIfAborted();
      const container = doc.querySelector("#canvas");
      if (!container || this.#frames.get(doc) !== frame)
        throw new DOMException("PDF frame was retired", "AbortError");
      frame.live?.release();
      container.replaceChildren(doc.adoptNode(canvas));
      frame.live = next;
      frame.pending = undefined;
      frame.signature = signature;
      reservation = undefined;
      return viewport;
    } finally {
      signal.removeEventListener("abort", abort);
      reservation?.release();
      if (frame.pending === reservation) frame.pending = undefined;
      pageLease.release();
    }
  }

  releaseDocument(doc: Document) {
    const frame = this.#frames.get(doc);
    if (!frame) return;
    this.#frames.delete(doc);
    frame.owner.abort();
    frame.pending?.release();
    frame.live?.release();
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const doc of this.#frames.keys()) this.releaseDocument(doc);
    this.ledger.close();
  }
}
