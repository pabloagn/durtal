import type { PositionQueue, PositionSave } from "../position-queue";
import { SAVE_INTERVAL_MS } from "../position-queue";
import { getReaderRuntime } from "./runtime";
import type { DurableInput } from "./store";
import { coalescePositions } from "./outbox-policy";
import type { PositionMutation } from "./mutations";

/** Replaces the legacy fetch/beacon queue in the mounted reader. This adapter
 * captures original intent and commits it; only the shared transport sends HTTP.
 */
export function createDurablePositionQueue(options: {
  ebookId: string; deviceId: string | null; onError: (error: unknown) => void;
}): PositionQueue {
  let writes: Promise<void> = Promise.resolve(), writeCount = 0, destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const failed = new Map<string, DurableInput>();
  const clear = () => { if (timer) clearTimeout(timer); timer = null; };
  async function persist(input: DurableInput) {
    try {
      await (await getReaderRuntime()).store.enqueue(input);
      failed.delete(input.mutation.operationId);
    } catch (error) {
      // A storage refusal never falls through to another HTTP replayer or
      // invents a timestamp/device. Keep the exact original for a later flush.
      failed.set(input.mutation.operationId, input);
      const keep = coalescePositions([...failed.values()].map((entry, index) => ({
        seq: index + 1, mutation: entry.mutation, attempts: 0, state: "waiting", claim: null,
      }))).keep;
      const retained = new Set(keep.map(row => row.mutation.operationId));
      for (const id of failed.keys()) if (!retained.has(id)) failed.delete(id);
      options.onError(error);
    }
  }
  async function flush({ beacon = false }: { beacon?: boolean } = {}) {
    clear(); await writes;
    for (const input of [...failed.values()]) await persist(input);
    if (failed.size) return false;
    try {
      const runtime = await getReaderRuntime();
      await runtime.requestReplay(beacon ? "lifecycle" : "foreground");
      return !(await runtime.store.inspect()).some(row => row.mutation.ebookId === options.ebookId);
    } catch (error) { options.onError(error); return false; }
  }
  return {
    push(save: PositionSave) {
      if (destroyed) return;
      if (!options.deviceId) { options.onError(new Error("Original reader device unavailable")); return; }
      const original = JSON.parse(JSON.stringify(save)) as PositionSave;
      const mutation: PositionMutation = { v: 1, kind: "position", operationId: crypto.randomUUID(), revision: 1,
        ebookId: options.ebookId, fileId: original.fileId, deviceId: options.deviceId,
        createdAt: original.clientUpdatedAt, body: original };
      writeCount++;
      writes = writes.then(() => persist({ mutation })).finally(() => { writeCount--; });
      if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, SAVE_INTERVAL_MS);
    },
    flush,
    get pending() { return writeCount > 0 || failed.size > 0; },
    destroy() { destroyed = true; clear(); void flush({ beacon: true }); },
  };
}
