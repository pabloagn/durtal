import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  PDFPageProxy,
} from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import type { BookSource, DurtalLocator, PdfTextPageRequest, PdfPageText } from "@/lib/reader/engine";
import { pdfDocumentOptions } from "./pdf-options";
import { pdfRangeChunks, PDF_MAX_CONCURRENT_RANGES } from "./pdf-range";
import { PdfRangeSource } from "./pdf-range-source";
import { forPdfOwner } from "./pdf-lifetime";
import { createOwnedPdfWorker } from "./pdf-worker";
import { pdfTextRuns, PdfTextMeasurementQueue } from "./pdf-text-measure";
import { pdfLocatorFromTextOffsets } from "./pdf-text-geometry";
import { pdfGeometryViewport } from "./pdf-viewport";

type PdfApi = Pick<
  typeof import("pdfjs-dist"),
  | "version"
  | "PDFWorker"
  | "PDFDataRangeTransport"
  | "getDocument"
  | "TextLayer"
>;
export type { PdfTextPageRequest } from "@/lib/reader/engine";
interface PageEntry {
  promise: Promise<PDFPageProxy>;
  page?: PDFPageProxy;
  leases: number;
}
const MAX_CACHED_PAGES = 16;
const MAX_CACHED_TEXT_BYTES = 4 * 1024 * 1024;

/** Owns one opened document; page consumers never own its shared transport. */
export class PdfSession {
  readonly range: PdfRangeSource;
  readonly pageCount: number;
  readonly failure: Promise<never>;
  #api: PdfApi;
  #pdf: PDFDocumentProxy | null;
  #task: PDFDocumentLoadingTask | null;
  #worker: ReturnType<typeof createOwnedPdfWorker> | null;
  #source: BookSource;
  #closed: AbortController;
  #pages = new Map<number, PageEntry>();
  #text = new Map<
    number,
    { promise: Promise<TextContent>; bytes: number; ready: boolean }
  >();
  #textBytes = 0;
  #measure = new PdfTextMeasurementQueue();
  #destroying: Promise<void> | undefined;
  #labels: Promise<string[] | null> | null = null;

  constructor(input: {
    api: PdfApi;
    pdf: PDFDocumentProxy;
    task: PDFDocumentLoadingTask;
    worker: ReturnType<typeof createOwnedPdfWorker>;
    source: BookSource;
    range: PdfRangeSource;
    closed: AbortController;
    failure: Promise<never>;
  }) {
    this.#api = input.api;
    this.#pdf = input.pdf;
    this.#task = input.task;
    this.#worker = input.worker;
    this.#source = input.source;
    this.range = input.range;
    this.#closed = input.closed;
    this.pageCount = input.pdf.numPages;
    this.failure = input.failure;
  }

  get document() {
    this.#closed.signal.throwIfAborted();
    if (!this.#pdf) throw new Error("The PDF is closed");
    return this.#pdf;
  }

  get signal() {
    return this.#closed.signal;
  }

  #validate(index: number) {
    this.#closed.signal.throwIfAborted();
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.pageCount)
      throw new RangeError("PDF page is outside this document");
  }

  async acquirePage(pageIndex: number, owner: AbortSignal) {
    this.#validate(pageIndex);
    const signal = AbortSignal.any([owner, this.#closed.signal]);
    signal.throwIfAborted();
    let entry = this.#pages.get(pageIndex);
    if (!entry) {
      entry = { promise: this.document.getPage(pageIndex + 1), leases: 0 };
      const pending = entry;
      pending.promise = pending.promise.then((page) => {
        pending.page = page;
        if (this.#closed.signal.aborted) page.cleanup();
        this.#evictPages();
        return page;
      });
      this.#pages.set(pageIndex, entry);
    } else {
      this.#pages.delete(pageIndex);
      this.#pages.set(pageIndex, entry);
    }
    const owned = entry;
    owned.leases++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      owned.leases--;
      this.#evictPages();
    };
    try {
      const page = await forPdfOwner(owned.promise, signal);
      return { page, release };
    } catch (error) {
      release();
      if (!signal.aborted && this.#pages.get(pageIndex) === owned)
        this.#pages.delete(pageIndex);
      throw error;
    }
  }

  #evictPages() {
    for (const [index, entry] of this.#pages) {
      if (this.#pages.size <= MAX_CACHED_PAGES) break;
      if (entry.leases || !entry.page) continue;
      entry.page.cleanup();
      this.#pages.delete(index);
    }
  }

  pageTextContent(pageIndex: number, owner: AbortSignal) {
    this.#validate(pageIndex);
    const signal = AbortSignal.any([owner, this.#closed.signal]);
    signal.throwIfAborted();
    let entry = this.#text.get(pageIndex);
    if (!entry) {
      const shared = {
        promise: Promise.resolve(null as unknown as TextContent),
        bytes: 0,
        ready: false,
      };
      shared.promise = this.acquirePage(pageIndex, this.#closed.signal)
        .then(async (lease) => {
          try {
            const content = await forPdfOwner(
              lease.page.getTextContent(),
              this.#closed.signal,
            );
            this.#closed.signal.throwIfAborted();
            shared.bytes = pdfTextRuns(content).text.length * 2;
            shared.ready = true;
            this.#textBytes += shared.bytes;
            this.#evictText();
            return content;
          } finally {
            lease.release();
          }
        })
        .catch((error: unknown) => {
          if (this.#text.get(pageIndex) === shared)
            this.#text.delete(pageIndex);
          throw error;
        });
      this.#text.set(pageIndex, shared);
      entry = shared;
    } else {
      this.#text.delete(pageIndex);
      this.#text.set(pageIndex, entry);
    }
    return forPdfOwner(entry.promise, signal);
  }

  #evictText() {
    for (const [index, entry] of this.#text) {
      if (
        this.#text.size <= MAX_CACHED_PAGES &&
        this.#textBytes <= MAX_CACHED_TEXT_BYTES
      )
        break;
      if (!entry.ready) continue;
      this.#textBytes -= entry.bytes;
      this.#text.delete(index);
    }
  }

  #request(request: PdfTextPageRequest) {
    this.#validate(request.pageIndex);
    request.signal.throwIfAborted();
    if (request.fileHash !== this.#source.sha256)
      throw new Error("PDF text offsets belong to a different file");
    return AbortSignal.any([request.signal, this.#closed.signal]);
  }

  async pdfPageText(request: PdfTextPageRequest): Promise<PdfPageText> {
    const signal = this.#request(request);
    const content = await this.pageTextContent(request.pageIndex, signal);
    this.#labels ??= this.document.getPageLabels();
    const labels = await forPdfOwner(this.#labels, signal);
    signal.throwIfAborted();
    return {
      fileHash: request.fileHash,
      pageIndex: request.pageIndex,
      pageLabel: labels?.[request.pageIndex] || String(request.pageIndex + 1),
      text: pdfTextRuns(content).text,
    };
  }

  async locatorForPdfTextOffsets(
    request: PdfTextPageRequest & { start: number; end: number },
    css: string,
  ): Promise<DurtalLocator | null> {
    const signal = this.#request(request);
    const content = await this.pageTextContent(request.pageIndex, signal);
    const text = pdfTextRuns(content).text;
    if (
      ![request.start, request.end].every(Number.isSafeInteger) ||
      request.start < 0 ||
      request.end <= request.start ||
      request.end > text.length
    )
      return null;
    const lease = await this.acquirePage(request.pageIndex, signal);
    try {
      const viewport = lease.page.getViewport({ scale: 1 });
      const geometry = await this.#measure.measure({
        document,
        content,
        viewport,
        TextLayer: this.#api.TextLayer,
        css,
        signal,
      });
      this.#labels ??= this.document.getPageLabels();
      const labels = await forPdfOwner(this.#labels, signal);
      signal.throwIfAborted();
      return pdfLocatorFromTextOffsets(geometry, request.start, request.end, {
        fileHash: this.#source.sha256,
        href: String(request.pageIndex),
        pageIndex: request.pageIndex,
        pageCount: this.pageCount,
        pageLabel: labels?.[request.pageIndex] || String(request.pageIndex + 1),
        viewport: pdfGeometryViewport(viewport),
      });
    } finally {
      lease.release();
    }
  }

  /** Abort consumers now; bound pdf.js destruction and retire owned references. */
  destroy() {
    if (this.#destroying) return this.#destroying;
    this.#closed.abort();
    this.range.close();
    this.#measure.close();
    this.#pages.clear();
    this.#text.clear();
    this.#textBytes = 0;
    this.#labels = null;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 1000);
    });
    const task = this.#task!;
    const worker = this.#worker!;
    const destruction = Promise.resolve()
      .then(() => task.destroy())
      .catch(() => {});
    this.#destroying = Promise.race([destruction, deadline]).finally(() => {
      clearTimeout(timer);
      this.#pdf = null;
      this.#task = null;
      this.#worker = null;
      worker.destroy();
    });
    return this.#destroying;
  }
}

export async function openPdfSession(
  api: PdfApi,
  source: BookSource,
  base: string,
  origin: string,
  createWorker?: (url: URL) => Worker,
  owner?: AbortSignal,
) {
  owner?.throwIfAborted();
  const range = new PdfRangeSource(source);
  const closed = new AbortController();
  const worker = createOwnedPdfWorker(api, base, origin, createWorker);
  let session: PdfSession | undefined;
  const abort = () => {
    closed.abort();
    range.close();
    if (session) void session.destroy().catch(() => {});
  };
  owner?.addEventListener("abort", abort, { once: true });
  closed.signal.addEventListener("abort", () => owner?.removeEventListener("abort", abort), { once: true });
  let transport: InstanceType<PdfApi["PDFDataRangeTransport"]>;
  try {
    transport = new api.PDFDataRangeTransport(source.size, new Uint8Array());
  } catch (error) {
    closed.abort();
    range.close();
    worker.destroy();
    throw error;
  }
  let rejectRange!: (error: unknown) => void;
  const rangeFailure = new Promise<never>((_resolve, reject) => {
    rejectRange = reject;
  });
  void rangeFailure.catch(() => {});
  transport.abort = () => {
    closed.abort();
    range.close();
  };
  transport.requestDataRange = (begin, end) => {
    void (async () => {
      const chunks = [...pdfRangeChunks(begin, end, source.size)];
      const bytes = new Uint8Array(Math.min(end, source.size) - begin);
      let next = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(PDF_MAX_CONCURRENT_RANGES, chunks.length) },
          async () => {
            while (next < chunks.length) {
              const chunk = chunks[next++];
              bytes.set(
                await range.read(chunk.begin, chunk.end, closed.signal),
                chunk.begin - begin,
              );
            }
          },
        ),
      );
      closed.signal.throwIfAborted();
      // PDFDataTransportStreamRangeReader consumes one complete logical range.
      // Each network read stays <=256 KiB; never send unsolicited sub-ranges.
      transport.onDataRange(begin, bytes);
    })().catch((error: unknown) => {
      if (!closed.signal.aborted) rejectRange(error);
    });
  };
  let task: PDFDocumentLoadingTask;
  try {
    task = api.getDocument({
      ...pdfDocumentOptions(base),
      range: transport,
      worker: worker.worker,
    });
  } catch (error) {
    closed.abort();
    range.close();
    worker.destroy();
    throw error;
  }
  const failure = Promise.race([rangeFailure, worker.failure]);
  void failure.catch((error: unknown) => {
    if (session) void session.destroy().catch(() => {});
    return error;
  });
  try {
    const pdf = await forPdfOwner(Promise.race([task.promise, failure]), closed.signal);
    session = new PdfSession({
      api,
      pdf,
      task,
      worker,
      source,
      range,
      closed,
      failure,
    });
    return session;
  } catch (error) {
    closed.abort();
    range.close();
    void Promise.resolve()
      .then(() => task.destroy())
      .catch(() => {});
    worker.destroy();
    throw error;
  }
}
