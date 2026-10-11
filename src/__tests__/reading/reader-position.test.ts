import { describe, expect, it } from "vitest";
import { countedReaderEnd, countReaderPosition, initialReaderPosition, sittingEnd } from "@/lib/reading/reader-position";

describe("counted reader locations", () => {
  const start = { percent: 20, chapter: "Chapter 2" };
  it("counts turns immediately and retains the furthest place on a previous-page turn", () => {
    const result = sittingEnd([
      { kind: "turn", percent: 21, activeMs: 0 },
      { kind: "turn", percent: 20, activeMs: 1000 },
    ], start);
    expect(result.state.counted.percent).toBe(20);
    expect(result.state.furthestPercent).toBe(21);
    expect(result.splits).toEqual([{ end: { percent: 21, chapter: null }, start: { percent: 20, chapter: null }, goingBack: "went_back" }]);
  });
  it("ignores short forward and backward exploratory jumps", () => {
    const result = sittingEnd([
      { kind: "jump", percent: 90, activeMs: 0 },
      { kind: "jump", percent: 10, activeMs: 30_000 },
      { kind: "jump", percent: 20, activeMs: 60_000 },
      { kind: "clock", activeMs: 150_000 },
    ], start);
    expect(result.state.counted).toEqual(start);
    expect(result.state.pending).toBeNull();
    expect(result.splits).toEqual([]);
  });
  it("qualifies a jump on active time only, including the exact two-minute boundary", () => {
    let state = countReaderPosition(initialReaderPosition(20), { kind: "jump", percent: 60, activeMs: 0 }).state;
    state = countReaderPosition(state, { kind: "clock", activeMs: 119_999 }).state;
    expect(state.counted.percent).toBe(20);
    state = countReaderPosition(state, { kind: "clock", activeMs: 120_000 }).state;
    expect(state.counted.percent).toBe(60);
  });
  it("counts a jump when reading onward and splits a qualified backward jump", () => {
    const result = sittingEnd([
      { kind: "jump", percent: 60, activeMs: 0 },
      { kind: "turn", percent: 61, activeMs: 1000 },
      { kind: "jump", percent: 30, activeMs: 2000 },
      { kind: "clock", activeMs: 122_000 },
      { kind: "turn", percent: 31, activeMs: 123_000 },
    ], start);
    expect(result.state.counted.percent).toBe(31);
    expect(result.state.furthestPercent).toBe(61);
    expect(result.splits).toHaveLength(1);
    expect(result.splits[0]).toMatchObject({ end: { percent: 61 }, start: { percent: 30 }, goingBack: "went_back" });
  });
  it("does not qualify the end from a pending contents jump", () => {
    const jumped = countReaderPosition(initialReaderPosition(20), { kind: "jump", percent: 100, activeMs: 0 });
    expect(countedReaderEnd(jumped.state)).toBe(false);
    expect(countedReaderEnd(countReaderPosition(jumped.state, { kind: "clock", activeMs: 120_000 }).state)).toBe(true);
  });
  it("preserves every split when a qualified jump and subsequent turn both go backwards", () => {
    const result = sittingEnd([
      { kind: "jump", percent: 15, activeMs: 0 },
      { kind: "turn", percent: 14, activeMs: 120_000 },
    ], start);
    expect(result.splits.map((split) => split.start.percent)).toEqual([15, 14]);
  });
  it("refuses invalid positions and regressing active counters", () => {
    expect(() => initialReaderPosition(Infinity)).toThrow();
    expect(() => countReaderPosition({ ...initialReaderPosition(20), activeMs: 10 }, { kind: "clock", activeMs: 9 })).toThrow();
  });
});
