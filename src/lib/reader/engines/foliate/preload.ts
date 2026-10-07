import type { ReaderFormat } from "@/lib/reader/engine";
import { PDF_WORKER_GLOBAL, PDF_WORKER_URL } from "@/lib/reader/first-range";

/**
 * The engine's code for one format, all downloading at once (eBooks
 * sub-issue 3). Opening a book, foliate-js loads its modules one after
 * another (the format's reader, then the view, then the renderer), and on a
 * phone each is a round trip before the first page. The reading view calls
 * this as it first renders, so they arrive together while the page's first
 * range downloads; the engine's own imports then find them loaded. A failure
 * is left to those imports, which report it.
 */
const started = new Map<ReaderFormat, Promise<unknown>>();

/**
 * The pdf.js worker. Its script is the largest download a PDF waits for, and
 * pdf.js would only start it once its own module had loaded and the document
 * was asked for: the page's inline script starts it once the book's first
 * bytes are in (src/lib/reader/first-range.ts), or this does, with the
 * engine's code, if it comes first. The engine hands it to pdf.js
 * (`GlobalWorkerOptions.workerPort`). It lasts as long as the page, which is
 * the reader's own (a full page load), and pdf.js reuses it for a second
 * document after a retry.
 */
export function startPdfWorker(): Worker | null {
  const page = window as unknown as Record<typeof PDF_WORKER_GLOBAL, Worker | undefined>;
  if (!page[PDF_WORKER_GLOBAL] && typeof Worker !== "undefined") {
    try {
      page[PDF_WORKER_GLOBAL] = new Worker(PDF_WORKER_URL, { type: "module" });
    } catch {
      // pdf.js starts its own
    }
  }
  return page[PDF_WORKER_GLOBAL] ?? null;
}

function modulesFor(format: ReaderFormat): Promise<unknown>[] {
  const view = [import("./engine"), import("@/vendor/foliate-js/view.js")];
  switch (format) {
    case "epub":
    case "kepub":
      return [...view, import("@/vendor/foliate-js/vendor/zip.js"), import("@/vendor/foliate-js/epub.js"), import("@/vendor/foliate-js/paginator.js")];
    case "fbz":
      return [...view, import("@/vendor/foliate-js/vendor/zip.js"), import("@/vendor/foliate-js/fb2.js"), import("@/vendor/foliate-js/paginator.js")];
    case "cbz":
      return [...view, import("@/vendor/foliate-js/vendor/zip.js"), import("@/vendor/foliate-js/comic-book.js"), import("@/vendor/foliate-js/fixed-layout.js")];
    case "pdf":
      startPdfWorker();
      return [...view, import("@/vendor/foliate-js/pdf.js"), import("pdfjs-dist"), import("@/vendor/foliate-js/fixed-layout.js")];
    case "fb2":
      return [...view, import("@/vendor/foliate-js/fb2.js"), import("@/vendor/foliate-js/paginator.js")];
    case "mobi":
    case "azw":
    case "azw3":
      return [...view, import("@/vendor/foliate-js/mobi.js"), import("@/vendor/foliate-js/vendor/fflate.js"), import("@/vendor/foliate-js/paginator.js")];
  }
}

export function preloadFoliate(format: ReaderFormat): Promise<unknown> {
  let loading = started.get(format);
  if (!loading) {
    loading = Promise.all(modulesFor(format)).catch(() => undefined);
    started.set(format, loading);
  }
  return loading;
}
