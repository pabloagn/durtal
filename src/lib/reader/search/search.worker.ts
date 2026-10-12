/// <reference lib="webworker" />
import { findInText, foldSearchSteps, type Folded } from "./fold";
import { checkAbort, yieldReaderTask } from "./task";
import type { WorkerRequest, WorkerResponse } from "./types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const CACHE_BYTES = 16 * 1024 * 1024;
const cache = new Map<string, { folded: Folded; bytes: number }>();
let cacheBytes = 0;
let active: AbortController | null = null;
let acknowledge: (() => void) | null = null;
const send = (message: WorkerResponse) => scope.postMessage(message);

async function search(
  request: Extract<WorkerRequest, { kind: "search" }>,
  signal: AbortSignal,
) {
  const key = JSON.stringify([
    request.key,
    request.options.matchCase,
    request.options.matchAccents,
    request.language,
  ]);
  let folded = cache.get(key)?.folded;
  if (folded) {
    const hit = cache.get(key)!;
    cache.delete(key);
    cache.set(key, hit);
  } else {
    const steps = foldSearchSteps(
      request.text,
      request.options,
      request.language,
    );
    let step = steps.next();
    let budget = performance.now();
    while (!step.done) {
      checkAbort(signal);
      if (performance.now() - budget >= 8) {
        await yieldReaderTask(signal);
        budget = performance.now();
      }
      step = steps.next();
    }
    folded = step.value;
    const bytes =
      folded.text.length * 2 + folded.from.byteLength + folded.to.byteLength;
    if (bytes <= CACHE_BYTES) {
      cache.set(key, { folded, bytes });
      cacheBytes += bytes;
      for (const [old, item] of cache) {
        if (cacheBytes <= CACHE_BYTES) break;
        cacheBytes -= item.bytes;
        cache.delete(old);
      }
    }
  }
  checkAbort(signal);
  let matches: { start: number; end: number }[] = [];
  let budget = performance.now();
  const flush = async () => {
    checkAbort(signal);
    // One unconsumed batch only. Install the ack before delivery.
    const consumed = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    send({ kind: "matches", id: request.id, matches });
    matches = [];
    await consumed;
    checkAbort(signal);
    budget = performance.now();
  };
  for (const match of findInText(
    request.text,
    request.query,
    request.options,
    request.language,
    folded,
    request.limit,
  )) {
    checkAbort(signal);
    matches.push(match);
    if (matches.length === 200) await flush();
    else if (performance.now() - budget >= 8) {
      await yieldReaderTask(signal);
      budget = performance.now();
    }
  }
  if (matches.length) await flush();
  checkAbort(signal);
  send({ kind: "done", id: request.id });
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.kind === "cancel") {
    active?.abort();
    acknowledge?.();
    acknowledge = null;
    cache.clear();
    cacheBytes = 0;
    send({ kind: "cancelled" });
  } else if (message.kind === "ack") {
    acknowledge?.();
    acknowledge = null;
  } else {
    if (active) {
      send({
        kind: "error",
        id: message.id,
        message: "Search worker is busy.",
      });
      return;
    }
    const controller = new AbortController();
    active = controller;
    void search(message, controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted)
          send({
            kind: "error",
            id: message.id,
            message: error instanceof Error ? error.message : "Search failed.",
          });
      })
      .finally(() => {
        if (active === controller) active = null;
      });
  }
};
