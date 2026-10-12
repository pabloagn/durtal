import type { MarkupIndex } from "./position-index";
import { indexDiagnosticEnabled, observeIndexDiagnostic } from "@/lib/reader/index-diagnostics";
export function scanInWorker(
  input: {
    fragments: string[];
    markup?: string;
    compressed?: ArrayBuffer;
    method?: number;
  },
  signal: AbortSignal,
): Promise<MarkupIndex> {
  const diagnostics = indexDiagnosticEnabled();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    if (diagnostics) observeIndexDiagnostic("worker-construct", () => ({ compressedBytes: input.compressed?.byteLength, markupLength: input.markup?.length, fragmentCount: input.fragments.length, method: input.method }));
    const worker = new Worker(new URL("./index-worker.ts", import.meta.url), {
      type: "module",
    });
    if (diagnostics) worker.addEventListener("messageerror", () => observeIndexDiagnostic("worker-messageerror"));
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      if (diagnostics) observeIndexDiagnostic("worker-abort");
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({
      data,
    }: MessageEvent<{ result?: MarkupIndex; error?: string; diagnosticPhase?: string; workerAt?: number }>) => {
      if (diagnostics && data.diagnosticPhase) {
        if (diagnostics) observeIndexDiagnostic(data.diagnosticPhase, () => ({ workerAt: data.workerAt }));
        return;
      }
      if (diagnostics) observeIndexDiagnostic(data.result ? "worker-result" : "worker-result-error", () => ({ length: data.result?.length, offsetCount: data.result ? Object.keys(data.result.offsets).length : undefined, errorCode: data.result ? undefined : "INDEX_WORKER_RESULT_ERROR" }));
      cleanup();
      if (data.result) resolve(data.result);
      else reject(new Error(data.error ?? "Index failed"));
    };
    worker.onerror = (event) => {
      if (diagnostics) observeIndexDiagnostic("worker-error", () => ({ errorName: "ErrorEvent", errorCode: "INDEX_WORKER_NATIVE_ERROR", filename: event.filename.split(/[?#]/, 1)[0], line: event.lineno, column: event.colno }));
      cleanup();
      reject(new Error(event.message));
    };
    worker.postMessage(diagnostics ? { ...input, diagnostics: true } : input, input.compressed ? [input.compressed] : []);
    if (diagnostics) observeIndexDiagnostic("worker-input-posted");
  });
}
