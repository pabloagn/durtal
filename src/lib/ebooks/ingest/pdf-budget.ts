import { inspectionBudget } from "./budget";
import { rasterHeader } from "./image-header";
import { checkedInteger, MiB, UPLOAD_LIMITS } from "../upload/limits";

export const PDF_INSPECTOR_SOURCE_SHA256 = "bb422f60804477de4a0b09091d8347a916a387755ed1cbad24ccaec1d09c78bf";
const HOOK = Symbol.for("durtal.inspector.pdf-budget.v1");
const MARKER = Symbol.for("durtal.inspector.pdf-patch.v1");

/** Installed only by the isolated worker, before loading its image-local pdf.js patch. */
export async function installPdfBudgetHooks(): Promise<void> {
  const global = globalThis as unknown as Record<symbol, unknown>;
  if (global[HOOK]) throw new Error("PDF inspection hooks are already installed");
  const streams = new WeakMap<object, { id: string; allocated: number }>(); let nextStream = 0;
  const budget = () => { const current = inspectionBudget(); if (!current) throw new Error("PDF parsing outside its bounded attempt"); current.assertHealthy(); return current; };
  global[HOOK] = Object.freeze({
    length(size: number) {
      try { checkedInteger(size, "PDF buffer length", 0, UPLOAD_LIMITS.entryDecodedBytes); }
      catch { budget().reject("PDF buffer length exceeds its inspection bound"); }
    },
    buffer(stream: object, size: number) {
      const current = budget();
      let entry = streams.get(stream);
      if (!entry) { entry = { id: `pdf:stream:${nextStream++}`, allocated: 0 }; streams.set(stream, entry); }
      if (size > entry.allocated) {
        current.decodedChunk(entry.id, size - entry.allocated);
        current.retainTextPermanent((size - entry.allocated) * 2); // decoded syntax may produce token + Unicode copies
        entry.allocated = size;
      }
    },
    text(units: number) { budget().retainTextPermanent(units); },
    image(width: number, height: number) { budget().imageAllocation(width, height, width * height * 32 + 8 * MiB); },
    jpeg(bytes: Uint8Array, width: number, height: number) {
      const current = budget();
      try {
        const actual = rasterHeader(bytes);
        if (actual.format !== "jpeg" || actual.width !== width || actual.height !== height) throw new Error("PDF JPEG frame dimensions differ");
        current.imageAllocation(width, height, width * height * 32 + bytes.length * 2 + 8 * MiB);
      } catch (error) { current.reject((error as Error).message); }
    },
    opaque(codec: string) { budget().reject(`PDF ${codec} decoder is outside the bounded inspection profile`); },
  });
  // Variable specifier avoids pretending the worker bundle has public TS types.
  const specifier = "pdfjs-dist/legacy/build/pdf.worker.mjs";
  await import(specifier);
  if (global[MARKER] !== PDF_INSPECTOR_SOURCE_SHA256) throw new Error("Pinned image-local PDF guard patch is missing");
}
