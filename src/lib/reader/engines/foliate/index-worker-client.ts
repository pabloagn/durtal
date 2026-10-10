import type { MarkupIndex } from "./position-index";
export function scanInWorker(
  input: {
    fragments: string[];
    markup?: string;
    compressed?: ArrayBuffer;
    method?: number;
  },
  signal: AbortSignal,
): Promise<MarkupIndex> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./index-worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({
      data,
    }: MessageEvent<{ result?: MarkupIndex; error?: string }>) => {
      cleanup();
      if (data.result) resolve(data.result);
      else reject(new Error(data.error ?? "Index failed"));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message));
    };
    worker.postMessage(input, input.compressed ? [input.compressed] : []);
  });
}
