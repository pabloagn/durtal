import { describe, expect, it, vi } from "vitest";
import { createSearchWorker } from "@/lib/reader/search/worker-client";
import { DEFAULT_SEARCH_OPTIONS } from "@/lib/reader/search/fold";
import type { WorkerResponse } from "@/lib/reader/search/types";

function fakeWorker() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as Worker["onmessage"],
    onerror: null as Worker["onerror"],
  };
  return {
    worker: worker as unknown as Worker,
    calls: worker,
    send(message: WorkerResponse) {
      worker.onmessage?.call(
        worker as unknown as Worker,
        { data: message } as MessageEvent,
      );
    },
  };
}
const request = {
  key: "file:0",
  text: "some text",
  query: "text",
  options: { ...DEFAULT_SEARCH_OPTIONS },
  language: "en",
  limit: 5000,
};
describe("search worker ownership", () => {
  it("acknowledges a batch only after the caller resumes consumption", async () => {
    const fake = fakeWorker();
    const signal = new AbortController();
    const worker = createSearchWorker(signal.signal, () => fake.worker);
    const iterator = worker.search(request);
    const first = iterator.next();
    fake.send({ kind: "matches", id: 1, matches: [{ start: 5, end: 9 }] });
    expect((await first).value).toEqual([{ start: 5, end: 9 }]);
    expect(fake.calls.postMessage).toHaveBeenCalledTimes(1);
    const end = iterator.next();
    expect(fake.calls.postMessage).toHaveBeenLastCalledWith({
      kind: "ack",
      id: 1,
    });
    fake.send({ kind: "done", id: 1 });
    expect((await end).done).toBe(true);
    worker.close();
    expect(fake.calls.terminate).toHaveBeenCalledTimes(1);
  });
  it("rejects delivery immediately on cancellation and terminates an unresponsive worker within 80ms", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeWorker();
      const signal = new AbortController();
      const worker = createSearchWorker(signal.signal, () => fake.worker);
      const first = worker.search(request).next();
      const rejected = expect(first).rejects.toMatchObject({
        name: "AbortError",
      });
      signal.abort();
      await rejected;
      expect(fake.calls.postMessage).toHaveBeenLastCalledWith({
        kind: "cancel",
      });
      fake.send({ kind: "matches", id: 1, matches: [{ start: 0, end: 2 }] });
      vi.advanceTimersByTime(80);
      expect(fake.calls.terminate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("releases an acknowledged cancellation without waiting for the deadline", async () => {
    const fake = fakeWorker();
    const signal = new AbortController();
    createSearchWorker(signal.signal, () => fake.worker);
    signal.abort();
    fake.send({ kind: "cancelled" });
    expect(fake.calls.terminate).toHaveBeenCalledTimes(1);
  });
});
