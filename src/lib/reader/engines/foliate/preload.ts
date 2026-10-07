import type { ReaderFormat } from "@/lib/reader/engine";

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
