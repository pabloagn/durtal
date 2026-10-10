import { IncrementalSha256 } from "./sha256";
const hash = new IncrementalSha256();
const worker = globalThis as unknown as { onmessage: ((event: MessageEvent<{ id: number; chunk?: ArrayBuffer; finish?: boolean }>) => void) | null; postMessage: (value: unknown) => void };
worker.onmessage = event => {
  try {
    if (event.data.chunk) hash.update(new Uint8Array(event.data.chunk));
    worker.postMessage({ id: event.data.id, ...(event.data.finish ? { sha256: hash.digest() } : {}) });
  } catch { worker.postMessage({ id: event.data.id, error: "File hashing failed" }); }
};
