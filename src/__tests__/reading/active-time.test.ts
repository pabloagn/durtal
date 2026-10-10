import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceActiveTime, initialActiveTime, nextActiveTimeDeadline } from "@/lib/reading/active-time";

const minute = 60_000;
afterEach(() => vi.useRealTimers());

describe("reader active time", () => {
  it("counts from activity, stops at five idle minutes, and owns no polling", () => {
    let state = initialActiveTime(0);
    state = advanceActiveTime(state, { kind: "checkpoint", at: minute }).state;
    expect(state.totalActiveMs).toBe(0);
    state = advanceActiveTime(state, { kind: "activity", at: minute }).state;
    expect(nextActiveTimeDeadline(state)).toBe(6 * minute);
    state = advanceActiveTime(state, { kind: "checkpoint", at: 20 * minute }).state;
    expect(state.activeMs).toBe(5 * minute);
    expect(nextActiveTimeDeadline(state)).toBe(31 * minute);
    const ended = advanceActiveTime(state, { kind: "checkpoint", at: 31 * minute });
    expect(ended.completed).toEqual({ startedAt: minute, endedAt: 31 * minute, activeMs: 5 * minute });
    expect(nextActiveTimeDeadline(ended.state)).toBeNull();
  });

  it("uses repeated activity to reach the automatic-start threshold with a fake clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let state = advanceActiveTime(initialActiveTime(0), { kind: "activity", at: Date.now() }).state;
    vi.advanceTimersByTime(4 * minute);
    state = advanceActiveTime(state, { kind: "activity", at: Date.now() }).state;
    vi.advanceTimersByTime(minute);
    state = advanceActiveTime(state, { kind: "checkpoint", at: Date.now() }).state;
    expect(state.totalActiveMs).toBe(5 * minute);
  });

  it("does not count hidden time or hidden input, and preserves a short hidden sitting", () => {
    let state = advanceActiveTime(initialActiveTime(0), { kind: "activity", at: 0 }).state;
    state = advanceActiveTime(state, { kind: "visibility", visible: false, at: minute }).state;
    state = advanceActiveTime(state, { kind: "activity", at: 5 * minute }).state;
    expect(state.lastActivityAt).toBe(0);
    const returned = advanceActiveTime(state, { kind: "visibility", visible: true, at: 6 * minute });
    expect(returned.completed).toBeNull();
    state = advanceActiveTime(returned.state, { kind: "activity", at: 6 * minute }).state;
    state = advanceActiveTime(state, { kind: "checkpoint", at: 7 * minute }).state;
    expect(state.startedAt).toBe(0);
    expect(state.activeMs).toBe(2 * minute);
  });

  it("closes a long hidden sitting without counting the hidden interval", () => {
    let state = advanceActiveTime(initialActiveTime(0), { kind: "activity", at: 0 }).state;
    state = advanceActiveTime(state, { kind: "visibility", visible: false, at: minute }).state;
    const returned = advanceActiveTime(state, { kind: "visibility", visible: true, at: 11 * minute });
    expect(returned.completed).toEqual({ startedAt: 0, endedAt: minute, activeMs: minute });
    state = advanceActiveTime(returned.state, { kind: "activity", at: 11 * minute }).state;
    expect(state.startedAt).toBe(11 * minute);
    expect(state.totalActiveMs).toBe(minute);
  });

  it("ends an idle sitting before new activity, retaining the open-book total", () => {
    const state = advanceActiveTime(initialActiveTime(0), { kind: "activity", at: 0 }).state;
    const next = advanceActiveTime(state, { kind: "activity", at: 40 * minute });
    expect(next.completed?.activeMs).toBe(5 * minute);
    expect(next.state.startedAt).toBe(40 * minute);
    expect(next.state.activeMs).toBe(0);
    expect(next.state.totalActiveMs).toBe(5 * minute);
  });

  it("flush checkpoints do not end a sitting and close is final", () => {
    let state = advanceActiveTime(initialActiveTime(0), { kind: "activity", at: 0 }).state;
    const flush = advanceActiveTime(state, { kind: "checkpoint", at: minute });
    expect(flush.completed).toBeNull();
    state = flush.state;
    const close = advanceActiveTime(state, { kind: "close", at: 2 * minute });
    expect(close.completed?.activeMs).toBe(2 * minute);
    const replay = advanceActiveTime(close.state, { kind: "activity", at: 3 * minute });
    expect(replay.completed).toBeNull();
    expect(replay.state.startedAt).toBeNull();
    expect(replay.state.totalActiveMs).toBe(2 * minute);
  });

  it("rejects backwards and invalid monotonic clocks", () => {
    expect(() => initialActiveTime(NaN)).toThrow("Invalid active clock");
    expect(() => advanceActiveTime(initialActiveTime(10), { kind: "activity", at: 9 })).toThrow("backwards");
  });
});
