import type { PDFWorker } from "pdfjs-dist";
import { PDFJS_VERSION, pdfDocumentOptions } from "./pdf-options";

export interface PdfWorkerApi {
  version: string;
  PDFWorker: Pick<typeof PDFWorker, "create">;
}

/** Explicit port ownership prevents pdf.js's main-thread fake-worker fallback. */
export function createOwnedPdfWorker(
  api: PdfWorkerApi,
  base: string,
  origin: string,
  createWorker: (url: URL) => Worker = (url) =>
    new Worker(url, { type: "module", name: "durtal-pdf" }),
) {
  pdfDocumentOptions(base);
  if (api.version !== PDFJS_VERSION)
    throw new Error("PDF API and staged worker versions differ");
  const url = new URL("pdf.worker.min.mjs", base);
  if (url.origin !== new URL(origin).origin)
    throw new Error("PDF worker assets must be served from the reader origin");
  const port = createWorker(url);
  let destroyed = false;
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  // A caller can race loading/rendering against this promise later. Observing
  // it here also prevents an early worker 404 from becoming unhandled.
  void failure.catch(() => {});
  const onError = () => {
    if (!destroyed)
      rejectFailure(new Error("PDF worker failed to load or run"));
  };
  port.addEventListener("error", onError);
  port.addEventListener("messageerror", onError);
  let worker: PDFWorker;
  try {
    worker = api.PDFWorker.create({ port });
  } catch (error) {
    port.removeEventListener("error", onError);
    port.removeEventListener("messageerror", onError);
    port.terminate();
    throw error;
  }
  return {
    worker,
    failure,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      port.removeEventListener("error", onError);
      port.removeEventListener("messageerror", onError);
      try {
        worker.destroy();
      } finally {
        // PDFWorker.destroy does not terminate a caller-supplied port.
        port.terminate();
      }
    },
  };
}
