import { cutChapter, isReaderEnd } from "./reader-progress";

export const JUMP_ACTIVE_MS = 2 * 60_000;
export interface CountedPlace { percent: number; chapter: string | null }
export interface ReaderPositionState {
  counted: CountedPlace;
  furthestPercent: number;
  activeMs: number;
  pending: { place: CountedPlace; sinceActiveMs: number } | null;
}
export type SittingPositionEvent =
  | { kind: "clock"; activeMs: number }
  | { kind: "turn" | "jump"; activeMs: number; percent: number; chapter?: string | null };
export interface PositionDecision {
  state: ReaderPositionState;
  /** Flush the preceding segment before allocating a new sitting for this move. */
  splits: { end: CountedPlace; start: CountedPlace; goingBack: "went_back" }[];
}

function place(percent: number, chapter?: string | null): CountedPlace {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100)
    throw new Error("Reader position must be from 0 to 100");
  return { percent, chapter: cutChapter(chapter) };
}

export function initialReaderPosition(percent: number, chapter?: string | null): ReaderPositionState {
  return { counted: place(percent, chapter), furthestPercent: percent, activeMs: 0, pending: null };
}

/** Constant-space location policy. Active time comes from active-time.ts. */
export function countReaderPosition(previous: ReaderPositionState, event: SittingPositionEvent): PositionDecision {
  if (!Number.isFinite(event.activeMs) || event.activeMs < previous.activeMs)
    throw new Error("Position active clock moved backwards");
  const state = { ...previous, activeMs: event.activeMs };
  const splits: PositionDecision["splits"] = [];
  const count = (next: CountedPlace) => {
    if (next.percent < state.counted.percent)
      splits.push({ end: state.counted, start: next, goingBack: "went_back" });
    state.counted = next;
    state.furthestPercent = Math.max(state.furthestPercent, next.percent);
    state.pending = null;
  };
  // Settle a qualified jump before another navigation, even if no timer ran at its deadline.
  if (state.pending && event.activeMs - state.pending.sinceActiveMs >= JUMP_ACTIVE_MS)
    count(state.pending.place);
  if (event.kind === "turn") count(place(event.percent, event.chapter));
  else if (event.kind === "jump") {
    const next = place(event.percent, event.chapter);
    if (next.percent === state.counted.percent) state.pending = null;
    else state.pending = { place: next, sinceActiveMs: event.activeMs };
  }
  return { state, splits };
}

/** Batch form for fixtures; production can feed the same reducer incrementally. */
export function sittingEnd(events: SittingPositionEvent[], start: CountedPlace): PositionDecision {
  let state = initialReaderPosition(start.percent, start.chapter);
  const splits: PositionDecision["splits"] = [];
  for (const event of events) {
    const result = countReaderPosition(state, event);
    state = result.state;
    splits.push(...result.splits);
  }
  return { state, splits };
}

export function countedReaderEnd(state: ReaderPositionState): boolean {
  return state.pending === null && isReaderEnd(state.counted.percent);
}
