import type { DurtalLocator, ReaderFormat } from "./engine";

export interface ReaderSelection {
  text: string;
  locator: DurtalLocator;
  fileId: string;
  chapter: string | null;
  percent: number;
}
export interface ReaderContext {
  ebookId: string;
  fileId: string;
  format: ReaderFormat;
  locator: DurtalLocator | null;
  percent: number | null;
  chapter: string | null;
  selection: ReaderSelection | null;
}
export interface ReaderEvents {
  activity: { at: number; kind: "turn" | "scroll" | "key" | "pointer" };
  location: {
    at: number;
    kind: "turn" | "jump";
    percent: number;
    chapter: string | null;
    locator: DurtalLocator;
    fileId: string;
  };
  end: { at: number; locator: DurtalLocator };
  selection: ReaderSelection | null;
}
export const readerPercent = (locator: DurtalLocator) =>
  Math.round(locator.totalProgression * 10000) / 100;

/** Dispatch after the displaying frame, never in an engine's relocate handler. */
export function createReaderEventBus(
  options: {
    frame?: (fn: FrameRequestCallback) => number;
    cancelFrame?: (id: number) => void;
    microtask?: (fn: () => void) => void;
    hidden?: () => boolean;
    now?: () => number;
  } = {},
) {
  const frame =
    options.frame ?? ((fn: FrameRequestCallback) => requestAnimationFrame(fn));
  const cancel =
    options.cancelFrame ?? ((id: number) => cancelAnimationFrame(id));
  const microtask = options.microtask ?? queueMicrotask;
  const hidden =
    options.hidden ?? (() => document.visibilityState === "hidden");
  const now = options.now ?? Date.now;
  const handlers = new Map<keyof ReaderEvents, Set<(payload: never) => void>>();
  const activityAt = new Map<ReaderEvents["activity"]["kind"], number>();
  const frames = new Set<number>();
  let destroyed = false;
  let generation = 0;
  let first = true;
  let arrivedAtEnd = false;
  let previous: DurtalLocator | null = null;
  function emit<K extends keyof ReaderEvents>(
    name: K,
    payload: ReaderEvents[K],
  ) {
    if (destroyed) return;
    const expected = generation;
    const id = frame(() => {
      frames.delete(id);
      microtask(() => {
        if (
          destroyed ||
          expected !== generation ||
          (name === "activity" && hidden())
        )
          return;
        for (const handler of [...(handlers.get(name) ?? [])]) {
          try {
            handler(payload as never);
          } catch (error) {
            console.error(`[reader] ${name} handler failed:`, error);
          }
        }
      });
    });
    frames.add(id);
  }
  return {
    on<K extends keyof ReaderEvents>(
      name: K,
      handler: (payload: ReaderEvents[K]) => void,
    ) {
      const set = handlers.get(name) ?? new Set();
      set.add(handler as (payload: never) => void);
      handlers.set(name, set);
      return () => {
        set.delete(handler as (payload: never) => void);
      };
    },
    emit,
    activity(kind: ReaderEvents["activity"]["kind"]) {
      const at = now();
      if (hidden() || at - (activityAt.get(kind) ?? -Infinity) < 1000) return;
      activityAt.set(kind, at);
      emit("activity", { at, kind });
    },
    location(
      input: Omit<ReaderEvents["location"], "at" | "percent"> & {
        atEnd: boolean;
      },
    ) {
      const { locator, kind, chapter, fileId, atEnd } = input;
      const changed =
        !previous ||
        previous.fileHash !== locator.fileHash ||
        previous.sectionIndex !== locator.sectionIndex ||
        previous.href !== locator.href ||
        previous.cfi !== locator.cfi ||
        previous.pdf?.page !== locator.pdf?.page ||
        Math.abs(previous.totalProgression - locator.totalProgression) > 1e-6;
      if (changed) {
        emit("location", {
          at: now(),
          kind: first ? "jump" : kind,
          percent: readerPercent(locator),
          chapter,
          locator,
          fileId,
        });
        previous = locator;
        first = false;
      }
      if (!atEnd && locator.totalProgression < 0.98) arrivedAtEnd = false;
      if (atEnd && !arrivedAtEnd) {
        arrivedAtEnd = true;
        emit("end", { at: now(), locator });
      }
    },
    start() {
      destroyed = false;
    },
    destroy() {
      destroyed = true;
      generation++;
      frames.forEach(cancel);
      frames.clear();
      handlers.clear();
    },
  };
}
