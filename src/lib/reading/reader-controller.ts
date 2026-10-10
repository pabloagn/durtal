import type { ReaderEvents, ReaderSelection } from "@/lib/reader/events";
import { advanceActiveTime, initialActiveTime, nextActiveTimeDeadline, ACTIVE_WINDOW_MS, type ActiveTimeEvent } from "./active-time";
import { countReaderPosition, countedReaderEnd, initialReaderPosition, JUMP_ACTIVE_MS, type ReaderPositionState } from "./reader-position";

export const READER_TRACKING_CONTROLLER_ID = "reading-tracker";
export type ReadingReaderEvents = Pick<ReaderEvents, "activity" | "location" | "end" | "selection">;
export interface ReaderSittingWire {
  sittingId: string;
  readingId: string;
  revision: number;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  startPercent: number;
  endPercent: number;
  endChapter: string | null;
  goingBack?: "went_back";
  timeZone: string;
}
export interface ReaderControllerOptions {
  now(): number;
  uuid(): string;
  timeZone: string;
  visible: boolean;
  readingId: string | null;
  initialPlace?: { percent: number; chapter: string | null };
  autoStart: boolean;
  /** Called with a real counted place only. No reading/source is fabricated. */
  start(startPercent: number, sitting: Omit<ReaderSittingWire, "readingId"> | null): Promise<{ readingId: string }>;
  save(sitting: Readonly<ReaderSittingWire>, beacon: boolean): void;
  reachedEnd(): void;
  selection(selection: ReaderSelection | null): void;
  changed(): void;
  failed(error: unknown): void;
  timer?: { set(fn: () => void, delay: number): unknown; clear(id: unknown): void };
}

/** Eager functional controller. React/UI loading owns no subscriptions or clocks.
 * Tracker activity, location, end and selection enter these handlers; no history is replayed.
 */
export function createReadingReaderController(options: ReaderControllerOptions) {
  const timers = options.timer ?? { set: (fn: () => void, delay: number) => setTimeout(fn, delay), clear: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>) };
  let time = initialActiveTime(options.now(), options.visible);
  let position: ReaderPositionState | null = options.initialPlace ? initialReaderPosition(options.initialPlace.percent, options.initialPlace.chapter) : null;
  let readingId = options.readingId;
  let segment: { id: string; startedAt: number; activeBase: number; startPercent: number; revision: number; goingBack: boolean } | null = null;
  let deadline: unknown = null;
  let disposed = false;
  let generation = 0;
  let startFlight: Promise<void> | null = null;
  let autoStart = options.autoStart;
  let held = false;
  let rawEnd = false;
  let offeredEnd = false;
  let writing = true;
  let suspended = false;
  let visible = options.visible;
  const staged = new Map<string, Omit<ReaderSittingWire, "readingId">>();
  const clock = (at = options.now()) => Math.max(time.at, Math.min(at, options.now()));

  function drain(beacon = false) {
    if (!writing || held || !readingId) return;
    for (const [id, snapshot] of staged) {
      try { options.save({ ...snapshot, readingId }, beacon); staged.delete(id); }
      catch (error) { options.failed(error); return; }
    }
  }

  function save(at: number, end = position?.counted, beacon = false) {
    if (!writing || !segment || !end) return;
    const activeSeconds = Math.floor((time.totalActiveMs - segment.activeBase) / 1000);
    if (activeSeconds < 1) return;
    if (activeSeconds > 86_400) {
      writing = false;
      options.failed(new Error("This sitting exceeds one day; reopen tracking before continuing"));
      return;
    }
    staged.set(segment.id, { sittingId: segment.id, revision: ++segment.revision,
      startedAt: new Date(segment.startedAt).toISOString(), endedAt: new Date(at).toISOString(), activeSeconds,
      startPercent: segment.startPercent, endPercent: end.percent, endChapter: end.chapter,
      ...(segment.goingBack ? { goingBack: "went_back" as const } : {}), timeZone: options.timeZone });
    drain(beacon);
  }

  function ensureSegment(at: number) {
    if (!segment && position && time.startedAt !== null) segment = { id: options.uuid(), startedAt: time.startedAt,
      activeBase: time.totalActiveMs - time.activeMs, startPercent: position.counted.percent, revision: 0, goingBack: false };
    if (segment && segment.startedAt > at) throw new Error("Reader sitting starts in the future");
  }

  function settlePosition(event: Parameters<typeof countReaderPosition>[1], at: number) {
    if (!position) return;
    const result = countReaderPosition(position, event);
    for (const split of result.splits) {
      save(at, split.end);
      segment = time.startedAt === null ? null : { id: options.uuid(), startedAt: at, activeBase: time.totalActiveMs,
        startPercent: split.end.percent, revision: 0, goingBack: true };
    }
    position = result.state;
  }

  function offerEnd() {
    if (!rawEnd || !position || !countedReaderEnd(position) || !readingId || held || offeredEnd) return;
    offeredEnd = true;
    save(time.at);
    options.reachedEnd();
  }

  function schedule() {
    if (deadline !== null) timers.clear(deadline);
    deadline = null;
    if (disposed || suspended) return;
    const candidates = [nextActiveTimeDeadline(time)];
    if (time.visible && time.lastActivityAt !== null) {
      const activeUntil = time.lastActivityAt + ACTIVE_WINDOW_MS;
      if (position?.pending) {
        const remaining = JUMP_ACTIVE_MS - (time.totalActiveMs - position.pending.sinceActiveMs);
        if (remaining > 0 && time.at + remaining <= activeUntil) candidates.push(time.at + remaining);
      }
      if (!readingId && autoStart && !held && time.totalActiveMs < ACTIVE_WINDOW_MS) {
        const threshold = time.at + ACTIVE_WINDOW_MS - time.totalActiveMs;
        if (threshold <= activeUntil) candidates.push(threshold);
      }
    }
    const next = candidates.filter((at): at is number => at !== null && at > time.at).sort((a, b) => a - b)[0];
    if (next !== undefined) deadline = timers.set(() => { deadline = null; advance({ kind: "checkpoint", at: clock() }); }, next - options.now());
  }

  function startTracking(): Promise<void> {
    if (disposed || suspended || readingId || !position || startFlight) return startFlight ?? Promise.resolve();
    const expected = generation;
    writing = true;
    save(time.at);
    const initial = [...staged.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0] ?? null;
    const startPercent = initial?.startPercent ?? segment?.startPercent ?? position.counted.percent;
    startFlight = options.start(startPercent, initial).then((started) => {
      if (expected !== generation) return;
      readingId = started.readingId;
      writing = true;
      drain(disposed);
      if (disposed) return;
      options.changed();
      offerEnd();
    }).catch((error: unknown) => {
      if (!disposed && expected === generation) { autoStart = false; options.failed(error); }
    }).finally(() => {
      if (expected === generation) { startFlight = null; schedule(); }
    });
    return startFlight;
  }

  function advance(event: ActiveTimeEvent, beacon = false) {
    if (disposed) return;
    if (suspended && event.kind !== "close") return;
    const result = advanceActiveTime(time, event);
    // Count a qualified jump using exactly the active time just accrued. A
    // backwards split closes the preceding segment before changing the place.
    const previousTotal = time.totalActiveMs;
    time = result.state;
    settlePosition({ kind: "clock", activeMs: time.totalActiveMs }, result.completed?.endedAt ?? event.at);
    if (result.completed) {
      // The reducer reset activeMs but the cumulative counter retained it.
      save(result.completed.endedAt, position?.counted, beacon);
      segment = null;
    }
    ensureSegment(event.at);
    if (!readingId && autoStart && !held && time.totalActiveMs >= ACTIVE_WINDOW_MS) void startTracking();
    offerEnd();
    if (time.totalActiveMs !== previousTotal || result.completed) options.changed();
    schedule();
  }

  const handlers: { [K in keyof ReadingReaderEvents]: (event: ReadingReaderEvents[K]) => void } = {
    activity(event) {
      advance({ kind: "activity", at: clock(event.at) });
    },
    location(event) {
      if (disposed) return;
      const at = clock(event.at);
      advance({ kind: "checkpoint", at });
      if (!position) {
        // The engine's genuine landing initializes the place, never server history.
        position = initialReaderPosition(event.percent, event.chapter);
        position.activeMs = time.totalActiveMs;
        ensureSegment(at);
      } else settlePosition({ kind: event.kind, activeMs: time.totalActiveMs, percent: event.percent, chapter: event.chapter }, at);
      if (event.percent < 99.5) { rawEnd = false; offeredEnd = false; }
      offerEnd(); options.changed(); schedule();
    },
    end(event) {
      if (disposed) return;
      advance({ kind: "checkpoint", at: clock(event.at) });
      rawEnd = true;
      offerEnd(); schedule();
    },
    selection(event) { if (!disposed) options.selection(event); },
  };

  return {
    handlers,
    startTracking,
    getSnapshot: () => ({ readingId, sittingId: segment?.id ?? null, counted: position?.counted ?? null, totalActiveMs: time.totalActiveMs, held, writing, suspended, startedAt: segment?.startedAt ?? null }),
    visibility(visible: boolean) {
      // Visibility is retained even while a manual timer owns the reading.
      setVisible(visible);
      const at = clock();
      advance({ kind: "visibility", at, visible }, !visible);
      if (!visible) save(at, position?.counted, true);
    },
    flush(beacon = false) { const at = clock(); advance({ kind: "checkpoint", at }, beacon); save(at, position?.counted, beacon); },
    holdWrites(value: boolean) { held = value; if (!value) { drain(); offerEnd(); schedule(); } },
    suspend(value: boolean) {
      if (suspended === value) return;
      if (value) advance({ kind: "close", at: clock() });
      suspended = value;
      segment = null;
      time = initialActiveTime(clock(), visible);
      if (position) position = initialReaderPosition(position.counted.percent, position.counted.chapter);
      options.changed(); schedule();
    },
    stopTracking() {
      generation++; autoStart = false; writing = false; readingId = null;
      staged.clear(); held = false;
      segment = null;
      time = initialActiveTime(clock(), time.visible);
      if (position) position = initialReaderPosition(position.counted.percent, position.counted.chapter);
      options.changed(); schedule();
    },
    setReading(id: string | null) {
      generation++; readingId = id; writing = id !== null; segment = null;
      staged.clear(); held = false;
      time = initialActiveTime(clock(), time.visible);
      if (position) position = initialReaderPosition(position.counted.percent, position.counted.chapter);
      options.changed(); schedule();
    },
    dispose() {
      if (disposed) return startFlight ?? Promise.resolve();
      held = false;
      advance({ kind: "close", at: clock() }, true);
      disposed = true;
      if (deadline !== null) timers.clear(deadline);
      deadline = null;
      return startFlight ?? Promise.resolve();
    },
  };
  function setVisible(value: boolean) { visible = value; }
}
