import type { ReaderEvents } from "./events";
import type { createReaderEventBus } from "./events";

export const CONTROLLER_READY_TIMEOUT_MS = 5_000;
export const READER_CONTROLLER_EVENTS = [
  "activity", "location", "end", "selection",
] as const satisfies readonly (keyof ReaderEvents)[];
export type ReaderControllerHandlers = {
  [K in (typeof READER_CONTROLLER_EVENTS)[number]]: (event: ReaderEvents[K]) => void;
};
export type ReaderControllerFailureCode =
  | "reader_controller_load_failed"
  | "reader_controller_failed"
  | "reader_controller_timeout"
  | "reader_controller_unavailable";
type ControllerState = {
  readonly id: string;
  readonly status: "pending" | "ready" | "failed" | "degraded";
  readonly code?: ReaderControllerFailureCode;
};
export type ReaderControllerPermit = {
  readonly owner: object;
  readonly epoch: number;
  readonly revision: number;
};
type Lease = { token: object; dispose(): void };

/** A finite set of live subscribers; no events or historic snapshots are stored. */
export function createControllerReadiness(
  bus: ReturnType<typeof createReaderEventBus>,
  ids: readonly string[],
  initialFailures: Readonly<Record<string, ReaderControllerFailureCode>> = {},
) {
  if (new Set(ids).size !== ids.length || ids.some((id) => !id))
    throw new Error("Reader controller IDs must be unique and nonempty");
  if (Object.keys(initialFailures).some((id) => !ids.includes(id)))
    throw new Error("Reader failure must belong to a configured controller");
  const owner = {};
  const states = new Map<string, ControllerState>();
  const leases = new Map<string, Lease>();
  const listeners = new Set<() => void>();
  const waits = new Set<(error?: Error) => void>();
  let active = false;
  let epoch = 0;
  let revision = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    states.clear();
    for (const id of ids)
      states.set(id, initialFailures[id]
        ? { id, status: "failed", code: initialFailures[id] }
        : { id, status: "pending" });
  };
  reset();
  const settled = () => active && [...states.values()].every(
    (state) => state.status === "ready" || state.status === "degraded",
  );
  const snapshot = () => ({ epoch, revision, active, ready: settled(), controllers: [...states.values()] });
  let current = snapshot();
  const clearWatchdog = () => {
    if (watchdog !== undefined) clearTimeout(watchdog);
    watchdog = undefined;
  };
  function changed() {
    revision++;
    current = snapshot();
    listeners.forEach((listener) => listener());
    [...waits].forEach((wait) => wait());
    const pending = active && [...states.values()].some((state) => state.status === "pending");
    if (!pending) clearWatchdog();
    else if (watchdog === undefined) {
      const expected = epoch;
      watchdog = setTimeout(() => {
        watchdog = undefined;
        if (!active || epoch !== expected) return;
        for (const [id, state] of states)
          if (state.status === "pending")
            states.set(id, { id, status: "failed", code: "reader_controller_timeout" });
        changed();
      }, CONTROLLER_READY_TIMEOUT_MS);
    }
  }
  const known = (id: string) => {
    const state = states.get(id);
    if (!state) throw new Error(`Unconfigured reader controller: ${id}`);
    return state;
  };
  const permit = (): ReaderControllerPermit => ({ owner, epoch, revision });
  function fail(id: string, code: ReaderControllerFailureCode, expected: number) {
    const state = known(id);
    if (expected !== epoch || ((state.status === "failed" || state.status === "degraded") && state.code === code)) return;
    leases.get(id)?.dispose();
    leases.delete(id);
    states.set(id, { id, status: "failed", code });
    changed();
  }
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    isPermitCurrent(value: ReaderControllerPermit) {
      return settled() && value.owner === owner && value.epoch === epoch && value.revision === revision;
    },
    whenReady(signal: AbortSignal): Promise<ReaderControllerPermit> {
      if (signal.aborted) return Promise.reject(new DOMException("Reader startup cancelled", "AbortError"));
      if (settled()) return Promise.resolve(permit());
      const expected = epoch;
      return new Promise((resolve, reject) => {
        const finish = (error?: Error) => {
          if (!error && epoch === expected && !settled()) return;
          waits.delete(finish);
          signal.removeEventListener("abort", abort);
          if (error) reject(error);
          else if (epoch !== expected) reject(new DOMException("Reader generation replaced", "AbortError"));
          else resolve(permit());
        };
        const abort = () => finish(new DOMException("Reader startup cancelled", "AbortError"));
        waits.add(finish);
        signal.addEventListener("abort", abort, { once: true });
        finish();
      });
    },
    install(id: string, handlers: ReaderControllerHandlers) {
      const state = known(id);
      if (state.status === "failed" || state.status === "degraded")
        throw new Error(`Reader controller requires retry: ${id}`);
      if (leases.has(id)) throw new Error(`Duplicate reader controller: ${id}`);
      const expected = epoch;
      const token = {};
      const unsubscribe: (() => void)[] = [];
      let live = true;
      const dispose = () => {
        if (!live) return;
        live = false;
        unsubscribe.forEach((off) => off());
      };
      try {
        const install = <K extends keyof ReaderControllerHandlers>(name: K) => {
          if (typeof handlers[name] !== "function") throw new Error(`Missing reader controller handler: ${name}`);
          unsubscribe.push(bus.on(name, (payload) => {
            if (live && active && expected === epoch && leases.get(id)?.token === token) {
              try { handlers[name](payload); }
              catch (error) { fail(id, "reader_controller_failed", expected); throw error; }
            }
          }));
        };
        READER_CONTROLLER_EVENTS.forEach(install);
      } catch (error) {
        dispose();
        throw error;
      }
      leases.set(id, { token, dispose });
      states.set(id, { id, status: "ready" });
      changed();
      return () => {
        if (epoch !== expected || leases.get(id)?.token !== token) { dispose(); return; }
        leases.delete(id); // Invalidate admission before subscriptions are removed.
        states.set(id, { id, status: "pending" });
        dispose();
        changed();
      };
    },
    fail,
    visibleFailure(id: string, code: ReaderControllerFailureCode, expected: number) {
      const state = known(id);
      if (expected !== epoch || state.status !== "failed" || state.code !== code) return () => {};
      const visible = {};
      leases.set(id, { token: visible, dispose() {} });
      states.set(id, { id, status: "degraded", code });
      changed();
      return () => {
        if (epoch !== expected || leases.get(id)?.token !== visible) return;
        leases.delete(id);
        states.set(id, { id, status: "failed", code });
        changed();
      };
    },
    start() {
      if (active) return;
      active = true;
      bus.start();
      changed();
    },
    destroy() {
      active = false;
      epoch++;
      clearWatchdog();
      leases.forEach((lease) => lease.dispose());
      leases.clear();
      bus.destroy();
      reset();
      changed();
    },
  };
}
