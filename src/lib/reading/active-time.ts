export const ACTIVE_WINDOW_MS = 5 * 60_000;
export const SITTING_IDLE_MS = 30 * 60_000;
export const SITTING_MERGE_MS = 10 * 60_000;

export interface SittingTime {
  startedAt: number;
  endedAt: number;
  activeMs: number;
}

export interface ActiveTimeState {
  at: number;
  visible: boolean;
  hiddenAt: number | null;
  lastActivityAt: number | null;
  startedAt: number | null;
  activeMs: number;
  totalActiveMs: number;
  closed: boolean;
}

export type ActiveTimeEvent =
  | { kind: "activity" | "checkpoint" | "close"; at: number }
  | { kind: "visibility"; at: number; visible: boolean };

export function initialActiveTime(at: number, visible = true): ActiveTimeState {
  if (!Number.isFinite(at)) throw new Error("Invalid active clock");
  return { at, visible, hiddenAt: visible ? null : at, lastActivityAt: null,
    startedAt: null, activeMs: 0, totalActiveMs: 0, closed: false };
}

/** A caller drives this reducer with a monotonic clock; it owns no timer or DOM. */
export function advanceActiveTime(previous: ActiveTimeState, event: ActiveTimeEvent): {
  state: ActiveTimeState;
  completed: SittingTime | null;
} {
  if (!Number.isFinite(event.at) || event.at < previous.at)
    throw new Error("Active clock moved backwards");
  const state = { ...previous, at: event.at };
  if (state.closed) return { state, completed: null };
  const elapsed = previous.visible && previous.lastActivityAt !== null
    ? Math.max(0, Math.min(event.at, previous.lastActivityAt + ACTIVE_WINDOW_MS) - previous.at)
    : 0;
  state.activeMs += elapsed;
  state.totalActiveMs += elapsed;
  let completed: SittingTime | null = null;
  const idle = state.lastActivityAt !== null && event.at >= state.lastActivityAt + SITTING_IDLE_MS;
  const hiddenExpired = state.hiddenAt !== null && event.at >= state.hiddenAt + SITTING_MERGE_MS;
  if (state.startedAt !== null && (idle || hiddenExpired || event.kind === "close")) {
    const endedAt = hiddenExpired ? state.hiddenAt! : idle
      ? state.lastActivityAt! + SITTING_IDLE_MS : event.at;
    completed = { startedAt: state.startedAt, endedAt, activeMs: state.activeMs };
    state.startedAt = null;
    state.lastActivityAt = null;
    state.activeMs = 0;
  }
  if (event.kind === "visibility") {
    if (event.visible !== state.visible) {
      state.hiddenAt = event.visible ? null : event.at;
      state.visible = event.visible;
    }
  } else if (event.kind === "activity" && state.visible) {
    state.startedAt ??= event.at;
    state.lastActivityAt = event.at;
  } else if (event.kind === "close") {
    state.closed = true;
  }
  return { state, completed };
}

/** One deadline suffices; after the active window there is no counting tick. */
export function nextActiveTimeDeadline(state: ActiveTimeState): number | null {
  if (state.closed || state.startedAt === null || state.lastActivityAt === null) return null;
  if (!state.visible && state.hiddenAt !== null)
    return Math.min(state.hiddenAt + SITTING_MERGE_MS, state.lastActivityAt + SITTING_IDLE_MS);
  const activeEnd = state.lastActivityAt + ACTIVE_WINDOW_MS;
  return activeEnd > state.at ? activeEnd : state.lastActivityAt + SITTING_IDLE_MS;
}
