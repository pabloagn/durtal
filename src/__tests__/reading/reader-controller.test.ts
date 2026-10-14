import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadingReaderController, type ReaderControllerOptions, type ReaderSittingWire } from "@/lib/reading/reader-controller";
import type { DurtalLocator } from "@/lib/reader/engine";

const minute = 60_000;
const readingId = "10000000-0000-4000-8000-000000000001";
const locator: DurtalLocator = { v: 1, fileHash: "a".repeat(64), href: "chapter.xhtml", sectionIndex: 0, progression: 0.1, totalProgression: 0.1 };

function setup(overrides: Partial<ReaderControllerOptions> = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let sequence = 0;
  const saved: ReaderSittingWire[] = [];
  const start = vi.fn(async () => ({ readingId }));
  const end = vi.fn();
  const controller = createReadingReaderController({ now: Date.now, uuid: () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    timeZone: "UTC", visible: true, readingId, autoStart: false,
    initialPlace: { percent: 10, chapter: "One" }, start, save: (snapshot) => saved.push(snapshot),
    reachedEnd: end, selection: vi.fn(), changed: vi.fn(), failed: vi.fn(), ...overrides });
  const activity = () => controller.handlers.activity({ at: Date.now(), kind: "turn" });
  const location = (percent: number, kind: "turn" | "jump" = "turn", opening?: true) => controller.handlers.location({ at: Date.now(), percent,
    chapter: "One", kind, fileId: readingId, locator: { ...locator, totalProgression: percent / 100 }, ...(opening ? { opening } : {}) });
  return { controller, saved, start, end, activity, location };
}

afterEach(() => vi.useRealTimers());

describe("eager reading controller", () => {
  it("starts only after five genuinely active minutes and includes its first sitting", async () => {
    const t = setup({ readingId: null, autoStart: true });
    await vi.advanceTimersByTimeAsync(10 * minute);
    expect(t.start).not.toHaveBeenCalled();
    t.activity();
    await vi.advanceTimersByTimeAsync(5 * minute - 1);
    expect(t.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.start).toHaveBeenCalledOnce();
    expect(t.start).toHaveBeenCalledWith(10, expect.objectContaining({ activeSeconds: 300, startPercent: 10 }));
    expect(t.controller.getSnapshot().readingId).toBe(readingId);
    await t.controller.dispose();
  });

  it("amends one identity and counts no hidden time", async () => {
    const t = setup();
    t.activity();
    await vi.advanceTimersByTimeAsync(minute);
    t.controller.flush();
    t.controller.visibility(false);
    await vi.advanceTimersByTimeAsync(4 * minute);
    t.controller.visibility(true);
    t.activity();
    await vi.advanceTimersByTimeAsync(minute);
    t.controller.flush();
    expect(new Set(t.saved.map((snapshot) => snapshot.sittingId)).size).toBe(1);
    expect(t.saved.at(-1)?.activeSeconds).toBe(120);
    expect(t.saved.at(-1)!.revision).toBeGreaterThan(t.saved[0].revision);
    await t.controller.dispose();
  });

  it("keeps completed sittings during a pending start and the Undo hold", async () => {
    let finish!: (value: { readingId: string }) => void;
    const start = vi.fn(() => new Promise<{ readingId: string }>((resolve) => { finish = resolve; }));
    const t = setup({ readingId: null, start, autoStart: false });
    t.activity();
    await vi.advanceTimersByTimeAsync(minute);
    const pending = t.controller.startTracking();
    t.controller.holdWrites(true);
    t.controller.visibility(false);
    await vi.advanceTimersByTimeAsync(11 * minute);
    t.controller.visibility(true);
    t.activity();
    await vi.advanceTimersByTimeAsync(minute);
    t.controller.flush();
    finish({ readingId });
    await pending;
    expect(t.saved).toHaveLength(0);
    t.controller.holdWrites(false);
    expect(new Set(t.saved.map((snapshot) => snapshot.sittingId)).size).toBe(2);
    expect(t.saved.reduce((sum, snapshot) => sum + snapshot.activeSeconds, 0)).toBe(120);
    await t.controller.dispose();
  });

  it("suppresses tracking while the manual timer owns the reading", async () => {
    const t = setup();
    t.controller.suspend(true);
    t.activity();
    await vi.advanceTimersByTimeAsync(20 * minute);
    t.controller.flush();
    expect(t.saved).toHaveLength(0);
    t.controller.suspend(false);
    t.activity();
    await vi.advanceTimersByTimeAsync(minute);
    t.controller.flush();
    expect(t.saved.at(-1)?.activeSeconds).toBe(60);
    await t.controller.dispose();
  });

  it("qualifies jumped-to end positions for two active minutes before offering Finish", async () => {
    const t = setup();
    t.activity();
    t.location(100, "jump");
    t.controller.handlers.end({ at: Date.now(), locator: { ...locator, totalProgression: 1 } });
    await vi.advanceTimersByTimeAsync(2 * minute - 1);
    expect(t.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.end).toHaveBeenCalledOnce();
    expect(t.saved.at(-1)?.endPercent).toBe(100);
    await t.controller.dispose();
  });

  it("starts the sitting at the place the reader opened at, and counts no short jump as read (SLN-677)", async () => {
    const t = setup({ initialPlace: { percent: 0, chapter: null } });
    t.activity();
    t.location(97.72, "jump", true);
    await vi.advanceTimersByTimeAsync(7000);
    t.location(97.9);
    await vi.advanceTimersByTimeAsync(7000);
    t.controller.flush();
    expect(t.saved.at(-1)).toMatchObject({ startPercent: 97.72, endPercent: 97.9 });
    expect(new Set(t.saved.map((snapshot) => snapshot.sittingId)).size).toBe(1);
    // Home, then reading on from the start: a new sitting from 0, never 97.9 → 1
    t.location(0, "jump");
    await vi.advanceTimersByTimeAsync(5000);
    t.location(1);
    await vi.advanceTimersByTimeAsync(5000);
    t.controller.flush();
    expect(t.saved.at(-1)).toMatchObject({ startPercent: 97.9, endPercent: 1, goingBack: "went_back" });
    // A short forward jump read on from starts a new sitting at the jump
    t.location(40, "jump");
    await vi.advanceTimersByTimeAsync(5000);
    t.location(41);
    await vi.advanceTimersByTimeAsync(5000);
    t.controller.flush();
    expect(t.saved.at(-1)).toMatchObject({ startPercent: 40, endPercent: 41 });
    expect(t.saved.at(-1)?.goingBack).toBeUndefined();
    await t.controller.dispose();
  });

  it("ends all deadlines and disregards later events on disposal", async () => {
    const t = setup({ readingId: null, autoStart: true });
    t.activity();
    await vi.advanceTimersByTimeAsync(minute);
    await t.controller.dispose();
    t.activity(); t.location(90);
    await vi.advanceTimersByTimeAsync(60 * minute);
    expect(t.start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
