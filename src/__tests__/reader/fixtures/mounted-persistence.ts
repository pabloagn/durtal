import { act } from "react";
import { IDBFactory } from "fake-indexeddb";
import { setImmediate as nextTask, setTimeout as deadlineTimer, clearTimeout as cancelDeadline } from "node:timers";
import { createReaderRuntime } from "@/lib/reader/offline/runtime";
import { openOfflineStore } from "@/lib/reader/offline/store";
import { validateSharedAnnotationBody } from "@/lib/reader/sync/annotation-codec";
import { mutationKey } from "@/lib/reader/offline/mutations";

/** The published package supplies only IndexedDB. Admission, original intent,
 * transactions, outbox policy, claim/settle and replay use production code.
 */
export async function mountedPersistence() {
  // Pinned Node22 provides this function. Vitest's normal happy-dom setup leaves
  // it on the Node global; supply that real function to the DOM window if absent.
  // A future environment without the Node function must fail, never JSON-clone.
  if (typeof globalThis.structuredClone !== "function") throw new Error("Mounted IndexedDB tests require Node structuredClone");
  if (typeof globalThis.setImmediate !== "function") throw new Error("Mounted IndexedDB tests require the real Node task scheduler");
  const previousClone = Object.getOwnPropertyDescriptor(window, "structuredClone");
  const suppliedClone = typeof window.structuredClone !== "function";
  if (suppliedClone) Object.defineProperty(window, "structuredClone", { configurable: true, writable: true, value: globalThis.structuredClone });
  const factory = new IDBFactory();
  const name = `mounted-reader-${crypto.randomUUID()}`;
  let reachable = false;
  const transportWindow = {
    document: window.document,
    navigator: { get onLine() { return reachable; } },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  } as unknown as Window;
  const restoreClone = () => {
    if (!suppliedClone) return;
    if (previousClone) Object.defineProperty(window, "structuredClone", previousClone);
    else Reflect.deleteProperty(window, "structuredClone");
  };
  const runtime = await createReaderRuntime({
    storage: { indexedDB: factory, name, channel: null },
    transport: {
      window: transportWindow, locks: null,
      fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    },
  }).catch(error => { restoreClone(); throw error; });
  const pending = new Set<Promise<unknown>>();
  const failures: unknown[] = [];
  let epoch = 0;
  // Observe real transaction promises without replacing their values or errors.
  // Original arguments and original promise are returned to the actual caller.
  function observe<Args extends unknown[], Value>(call: (...args: Args) => Promise<Value>) {
    return (...args: Args): Promise<Value> => {
      const flight = call(...args); epoch++; pending.add(flight);
      void flight.then(() => pending.delete(flight), error => { failures.push(error); pending.delete(flight); });
      return flight;
    };
  }
  runtime.store.enqueue = observe(runtime.store.enqueue.bind(runtime.store));
  runtime.store.transactBook = observe(runtime.store.transactBook.bind(runtime.store));
  runtime.store.sealDeletes = observe(runtime.store.sealDeletes.bind(runtime.store));
  runtime.store.claim = observe(runtime.store.claim.bind(runtime.store));
  runtime.store.settle = observe(runtime.store.settle.bind(runtime.store));
  runtime.store.inspect = observe(runtime.store.inspect.bind(runtime.store));
  const replays = new Set<Promise<void>>();
  const replay = runtime.requestReplay.bind(runtime);
  runtime.requestReplay = (...args: Parameters<typeof replay>) => {
    const flight = replay(...args); replays.add(flight);
    void flight.then(() => replays.delete(flight), () => replays.delete(flight));
    return flight;
  };
  async function bounded<Value>(work: Promise<Value>): Promise<Value> {
    let timer: ReturnType<typeof deadlineTimer> | undefined;
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = deadlineTimer(() => reject(new Error("Mounted persistence completion deadline exceeded")), 2000);
      })]);
    } finally { if (timer) cancelDeadline(timer); }
  }
  async function drainCommits() {
    await bounded((async () => {
      let stable = 0;
      for (let turn = 0; turn < 50; turn++) {
        const before = epoch;
        await Promise.allSettled([...pending]);
        // Admit the real adapter's serialized .then continuations. This advances
        // Node tasks, not the UI fake clock or the transport retry deadline.
        await new Promise<void>(resolve => nextTask(resolve));
        if (!pending.size && epoch === before) stable++; else stable = 0;
        if (stable === 2) {
          if (failures.length) throw new AggregateError(failures, "Actual durable store operation failed");
          return;
        }
      }
      throw new Error("Mounted durable operations did not settle within 50 real tasks");
    })());
  }
  async function connection() {
    await drainCommits();
    return bounded(openOfflineStore({ indexedDB: factory, name, channel: null, validateAnnotations: validateSharedAnnotationBody }));
  }
  async function readCommittedPositions() {
    const reopened = await connection();
    try {
      const positions = [];
      for (const row of await reopened.inspect()) {
        if (row.mutation.kind !== "position") continue;
        const local = await reopened.readPosition(mutationKey(row.mutation));
        positions.push({ ...row, mutation: row.mutation, latest: local?.latest, milestone: local?.milestone });
      }
      return positions;
    } finally { reopened.close(); }
  }
  async function snapshot(positionKey: string) {
    const reopened = await connection();
    try { return { queued: await reopened.inspect(), position: await reopened.readPosition(positionKey) }; }
    finally { reopened.close(); }
  }
  async function committedPositions() {
    let result: Awaited<ReturnType<typeof readCommittedPositions>> = [];
    await act(async () => { result = await bounded(readCommittedPositions()); });
    return result;
  }
  async function dispose() {
    try {
      await drainCommits();
      runtime.destroy();
      await bounded(Promise.allSettled([...replays]));
      // Internal event-driven replay is observed through its actual store work;
      // destroy aborts transport requests and this waits subsequent settlement.
      await drainCommits();
    } finally {
      runtime.destroy(); runtime.store.close();
      try {
        await bounded(new Promise<void>((resolve, reject) => {
          const request = factory.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error("Mounted fixture database still has an open connection"));
        }));
      } finally { restoreClone(); }
    }
  }
  return { runtime, committedPositions, snapshot, setReachable: (value: boolean) => { reachable = value; }, dispose };
}
