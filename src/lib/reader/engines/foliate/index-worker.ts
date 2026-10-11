import { scanMarkup } from "./position-index";
/** Index-only worker: large inflation, decoding and scanning never occupy the UI thread. */
const worker = globalThis as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          fragments: string[];
          markup?: string;
          compressed?: ArrayBuffer;
          method?: number;
          diagnostics?: boolean;
        }>,
      ) => void)
    | null;
  postMessage(value: unknown): void;
};
worker.onmessage = async ({ data }) => {
  if (data.diagnostics) {
      try { worker.postMessage({ diagnosticPhase: "worker-loaded-processing-start", workerAt: performance.now() }); }
      catch { /* Observation must not replace the original indexing outcome. */ }
    }
  try {
    let markup = data.markup ?? "";
    if (data.compressed) {
      let bytes: Uint8Array = new Uint8Array(data.compressed);
      if (data.method === 8) {
        try {
          const stream = new Blob([data.compressed])
            .stream()
            .pipeThrough(new DecompressionStream("deflate-raw"));
          markup = await new Response(stream).text();
        } catch {
          const { inflateSync } =
            (await import("@/vendor/foliate-js/vendor/fflate.js")) as unknown as {
              inflateSync(bytes: Uint8Array): Uint8Array;
            };
          bytes = inflateSync(bytes);
          markup = new TextDecoder().decode(bytes);
        }
      } else markup = new TextDecoder().decode(bytes);
    }
    if (data.diagnostics) {
      try { worker.postMessage({ diagnosticPhase: "worker-decode-complete-scan-start", workerAt: performance.now() }); }
      catch { /* Observation must not replace the original indexing outcome. */ }
    }
    const result = await scanMarkup(
      markup,
      data.fragments,
      new AbortController().signal,
    );
    if (data.diagnostics) {
      try { worker.postMessage({ diagnosticPhase: "worker-scan-complete", workerAt: performance.now() }); }
      catch { /* Observation must not replace the original indexing outcome. */ }
    }
    worker.postMessage({ result });
  } catch (error) {
    worker.postMessage({
      error: error instanceof Error ? error.message : "Index failed",
    });
  }
};
