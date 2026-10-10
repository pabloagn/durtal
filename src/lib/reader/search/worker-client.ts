import type { SearchOptions, TextMatch } from "./fold";
import { abortable, checkAbort } from "./task";
import type { WorkerRequest, WorkerResponse } from "./types";

export function createSearchWorker(
  signal: AbortSignal,
  makeWorker = () =>
    new Worker(new URL("./search.worker.ts", import.meta.url), {
      type: "module",
    }),
) {
  checkAbort(signal);
  const worker = makeWorker();
  let sequence = 0;
  let waiting: ((message: WorkerResponse) => void) | null = null;
  let queued: WorkerResponse | null = null;
  let failure: Error | null = null;
  let closed = false;
  let terminateTimer: ReturnType<typeof setTimeout> | null = null;
  const post = (message: WorkerRequest) => worker.postMessage(message);
  const receive = () => {
    checkAbort(signal);
    if (failure) return Promise.reject(failure);
    if (queued) {
      const result = queued;
      queued = null;
      return Promise.resolve(result);
    }
    return abortable(
      new Promise<WorkerResponse>((resolve) => {
        waiting = resolve;
      }),
      signal,
    );
  };
  const terminate = () => {
    worker.terminate();
    if (terminateTimer) clearTimeout(terminateTimer);
    terminateTimer = null;
    waiting = null;
    queued = null;
    signal.removeEventListener("abort", cancel);
  };
  const cancel = () => {
    closed = true;
    post({ kind: "cancel" });
    // A busy browser or crashed worker must still release its index and delivery owner.
    terminateTimer = setTimeout(terminate, 80);
  };
  signal.addEventListener("abort", cancel, { once: true });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (event.data.kind === "cancelled") {
      terminate();
      return;
    }
    if (closed || signal.aborted) return;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(event.data);
    } else queued = event.data;
  };
  worker.onerror = (event) => {
    failure = new Error(event.message || "The search worker failed.");
    waiting?.({ kind: "error", id: sequence, message: failure.message });
    waiting = null;
  };
  return {
    async *search(request: {
      key: string;
      text: string;
      query: string;
      options: SearchOptions;
      language: string;
      limit: number;
    }): AsyncGenerator<TextMatch[]> {
      checkAbort(signal);
      if (closed) throw new Error("Search worker closed.");
      const id = ++sequence;
      post({ kind: "search", id, ...request });
      while (true) {
        const message = await receive();
        checkAbort(signal);
        if (message.kind === "cancelled" || message.id !== id) continue;
        if (message.kind === "error") throw new Error(message.message);
        if (message.kind === "done") return;
        yield message.matches;
        checkAbort(signal);
        post({ kind: "ack", id });
      }
    },
    close() {
      closed = true;
      terminate();
    },
  };
}
