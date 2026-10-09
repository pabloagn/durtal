import { describe, it, expect, vi } from "vitest";
import { createReaderNavigation, painted } from "@/lib/reader/navigation";
import { ReaderHistory } from "@/lib/reader/history";
import type { DurtalLocator, EngineEvents } from "@/lib/reader/engine";
import { fakeEngine } from "./fixtures/fake-engine";
const at = (fraction: number): DurtalLocator => ({
  v: 1,
  fileHash: "a".repeat(64),
  href: "chapter",
  sectionIndex: 0,
  progression: fraction,
  totalProgression: fraction,
  cfi: "cfi" + fraction,
});
const relocation = (
  fraction: number,
  navigationId?: number,
): EngineEvents["relocate"] => ({
  locator: at(fraction),
  reason: "jump",
  chapter: "Chapter",
  atEnd: fraction === 1,
  visibleChars: 300,
  linear: true,
  paginated: true,
  tocItem: null,
  navigationId,
  originMark: "visible paragraph",
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const microtasks = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function session(paint = async (_signal: AbortSignal) => {}) {
  const { engine } = fakeEngine();
  let current = at(0);
  const commit = vi.fn();
  const interrupt = vi.fn();
  const navigation = createReaderNavigation({
    engine,
    commit,
    paint,
    interrupt,
  });
  engine.currentLocator = () => current;
  const arrive = (
    fraction: number,
    id?: number,
    reason: "turn" | "jump" = "jump",
  ) => {
    current = at(fraction);
    navigation.relocate({
      ...relocation(fraction, id),
      reason,
      origin: "human",
    });
  };
  engine.goTo.mockImplementation(async (target, owner) =>
    arrive(
      "v" in target
        ? target.totalProgression
        : "fraction" in target
          ? target.fraction
          : 0.5,
      owner?.id,
    ),
  );
  navigation.start(relocation(0));
  return { engine, navigation, commit, interrupt, arrive };
}
describe("painted session navigation", () => {
  it("queues the 38ms request through the real 100ms promise/unlock contract", async () => {
    vi.useFakeTimers();
    try {
      let locked = false,
        dropped = 0,
        firstPaint = true;
      const starts: number[] = [];
      const barrier = deferred();
      const s = session(async () => {
        if (firstPaint) {
          firstPaint = false;
          await barrier.promise;
        }
      });
      s.engine.next.mockImplementation(async (owner) => {
        if (locked) {
          dropped++;
          return;
        }
        locked = true;
        starts.push(Date.now());
        s.arrive(
          s.engine.currentLocator()!.totalProgression + 0.1,
          owner?.id,
          "turn",
        );
        await new Promise((done) => setTimeout(done, 100));
        locked = false;
      });
      const first = s.navigation.turn("next");
      await vi.advanceTimersByTimeAsync(38);
      const second = s.navigation.turn("next");
      await vi.advanceTimersByTimeAsync(61);
      expect(s.engine.next).toHaveBeenCalledOnce();
      expect(locked).toBe(true);
      expect(s.commit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(locked).toBe(false);
      expect(s.engine.next).toHaveBeenCalledOnce();
      const third = s.navigation.turn("next");
      barrier.resolve();
      await microtasks();
      expect(s.engine.next).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await Promise.all([first, second, third]);
      expect(dropped).toBe(0);
      expect(starts.map((at) => at - starts[0])).toEqual([0, 100, 200]);
      expect(
        s.commit.mock.calls.map(([place]) => place.locator.totalProgression),
      ).toEqual([0.1, 0.2, 0.30000000000000004]);
      expect(
        s.commit.mock.calls.every(
          ([place]) => place.reason === "turn" && place.origin === "human",
        ),
      ).toBe(true);
      expect(s.navigation.history.entries).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not let stale, unowned, layout or speech arrivals replace an owned turn", async () => {
    const barrier = deferred();
    const s = session(() => barrier.promise);
    s.engine.next.mockImplementation(async (owner) =>
      s.arrive(0.1, owner?.id, "turn"),
    );
    const turn = s.navigation.turn("next");
    await microtasks();
    s.navigation.relocate({
      ...relocation(0.8),
      reason: "turn",
      origin: "human",
    });
    s.navigation.relocate({
      ...relocation(0.9, 99),
      reason: "turn",
      origin: "human",
    });
    s.navigation.relocate({
      ...relocation(0.95, 1),
      reason: "layout",
      origin: "layout",
    });
    s.navigation.relocate({
      ...relocation(1, 1),
      reason: "turn",
      origin: "speech",
    });
    barrier.resolve();
    await turn;
    expect(s.commit).toHaveBeenCalledOnce();
    expect(s.commit.mock.calls[0][0]).toMatchObject({
      locator: at(0.1),
      atEnd: false,
      origin: "human",
    });
    s.navigation.relocate({
      ...relocation(1, 1),
      reason: "turn",
      origin: "human",
    });
    expect(s.commit).toHaveBeenCalledOnce();
  });
  it("refreshes unowned reflow quietly and preserves legitimate human scroll after paint", async () => {
    const s = session();
    await s.navigation.navigate({ fraction: 0.4 }, { source: "goto" });
    s.commit.mockClear();
    s.navigation.relocate(relocation(0.6)); // Legacy unowned anchor, without an origin tag.
    expect(s.commit).not.toHaveBeenCalled();
    await microtasks();
    expect(s.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "layout",
        origin: "layout",
        atEnd: false,
        locator: expect.objectContaining({
          cfi: "cfi0.6",
          totalProgression: 0.4,
        }),
      }),
    );
    expect(s.navigation.history.entries).toHaveLength(2);
    expect(s.navigation.history.cursor).toBe(1);
    s.commit.mockClear();
    s.navigation.relocate({
      ...relocation(0.7),
      reason: "turn",
      origin: "human",
      activity: "scroll",
      paginated: false,
    });
    expect(s.commit).not.toHaveBeenCalled();
    await microtasks();
    expect(s.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "turn",
        origin: "human",
        activity: "scroll",
        locator: at(0.7),
      }),
    );
    s.navigation.relocate({
      ...relocation(1),
      reason: "turn",
      origin: "speech",
    });
    await microtasks();
    expect(s.commit).toHaveBeenCalledOnce();
    expect(s.navigation.current?.locator).toEqual(at(0.7));
  });
  it("cancels an unowned paint when another operation supersedes it or the session closes", async () => {
    const barrier = deferred();
    const s = session(() => barrier.promise);
    s.navigation.relocate({
      ...relocation(0.2),
      reason: "turn",
      origin: "human",
      activity: "scroll",
    });
    s.navigation.relocate({
      ...relocation(1),
      reason: "turn",
      origin: "speech",
    });
    barrier.resolve();
    await microtasks();
    expect(s.commit).not.toHaveBeenCalled();
    s.navigation.relocate({
      ...relocation(0.3),
      reason: "layout",
      origin: "layout",
    });
    s.navigation.destroy();
    await microtasks();
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.navigation.history.cursor).toBe(0);
  });
  it("teardown aborts a hidden recovery paint and settles active and queued promises", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++sequence, callback);
      return sequence;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    try {
      const s = session(painted);
      const jump = s.navigation.navigate({ fraction: 0.9 }, { source: "goto" });
      s.navigation.cancel();
      await microtasks();
      expect(s.engine.goTo).toHaveBeenCalledTimes(2);
      expect(frames.size).toBe(1);
      const queued = s.navigation.turn("next");
      s.navigation.destroy();
      expect(await jump).toBeNull();
      expect(await queued).toBeNull();
      await microtasks();
      expect(frames.size).toBe(0);
      expect(s.commit).not.toHaveBeenCalled();
      expect(s.navigation.busy).toBe(false);
      expect(s.navigation.history.cursor).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("restarts the paint barrier for a newer owned arrival instead of publishing the stale locator", async () => {
    const gate = deferred();
    const paint = vi
      .fn(async (_signal: AbortSignal) => {})
      .mockImplementationOnce(() => gate.promise);
    const s = session(paint);
    const jump = s.navigation.navigate({ fraction: 0.5 }, { source: "goto" });
    await microtasks();
    s.arrive(0.55, 1);
    gate.resolve();
    await jump;
    expect(paint).toHaveBeenCalledTimes(2);
    expect(s.commit).toHaveBeenCalledOnce();
    expect(s.commit.mock.calls[0][0].locator.totalProgression).toBe(0.55);
    expect(
      s.navigation.history.entries.map(
        (entry) => entry.locator.totalProgression,
      ),
    ).toEqual([0, 0.55]);
  });
  it("queues every rapid ordinary turn through transition and paint without publishing stale places", async () => {
    const transition = deferred(),
      paint = deferred();
    let firstPaint = true;
    const s = session(async () => {
      if (firstPaint) {
        firstPaint = false;
        await paint.promise;
      }
    });
    s.engine.next.mockImplementationOnce(async (owner) => {
      s.arrive(0.1, owner?.id, "turn");
      await transition.promise;
    });
    s.engine.next.mockImplementation(async (owner) =>
      s.arrive(
        s.engine.currentLocator()!.totalProgression + 0.1,
        owner?.id,
        "turn",
      ),
    );
    const first = s.navigation.turn("next"),
      second = s.navigation.turn("next");
    expect(s.engine.next).toHaveBeenCalledOnce();
    transition.resolve();
    await microtasks();
    const third = s.navigation.turn("next");
    expect(s.engine.next).toHaveBeenCalledOnce();
    expect(s.commit).not.toHaveBeenCalled();
    paint.resolve();
    await Promise.all([first, second, third]);
    expect(s.engine.next).toHaveBeenCalledTimes(3);
    expect(
      s.commit.mock.calls.map(([place]) => place.locator.totalProgression),
    ).toEqual([0.1, 0.2, 0.30000000000000004]);
    expect(
      s.commit.mock.calls.every(([place]) => place.reason === "turn"),
    ).toBe(true);
    expect(s.navigation.history.entries).toHaveLength(1);
    expect(s.interrupt).not.toHaveBeenCalled();
  });
  it("publishes once after paint, never for same-place or unmatched arrivals", async () => {
    const barrier = deferred();
    const s = session(() => barrier.promise);
    const move = s.navigation.navigate(
      { fraction: 0.5 },
      { source: "contents" },
    );
    await microtasks();
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.navigation.history.cursor).toBe(0);
    barrier.resolve();
    await move;
    expect(s.commit).toHaveBeenCalledOnce();
    expect(s.navigation.history.cursor).toBe(1);
    await s.navigation.navigate(at(0.5), { source: "goto" });
    expect(s.engine.goTo).toHaveBeenCalledOnce();
    expect(s.commit).toHaveBeenCalledOnce();
    s.engine.goTo.mockImplementationOnce(async () => s.arrive(0.8, 999));
    await expect(
      s.navigation.navigate({ fraction: 0.8 }, { source: "goto" }),
    ).rejects.toThrow("did not finish");
    expect(s.engine.currentLocator()).toEqual(at(0.5));
    expect(s.navigation.history.cursor).toBe(1);
    expect(s.commit).toHaveBeenCalledOnce();
  });
  it("settles a cancelled jump, restores the committed origin, then turns from it", async () => {
    const gate = deferred();
    const s = session();
    s.engine.goTo.mockImplementationOnce(async (_target, owner) => {
      await gate.promise;
      s.arrive(0.9, owner?.id);
    });
    s.engine.next.mockImplementation(async (owner) =>
      s.arrive(
        s.engine.currentLocator()!.totalProgression + 0.1,
        owner?.id,
        "turn",
      ),
    );
    const jump = s.navigation.navigate(
      { fraction: 0.9 },
      { source: "scrubber" },
    );
    const turn = s.navigation.turn("next");
    expect(s.engine.next).not.toHaveBeenCalled();
    gate.resolve();
    await jump;
    await turn;
    expect(s.engine.goTo.mock.calls[1][0]).toEqual(at(0));
    expect(s.commit).toHaveBeenCalledOnce();
    expect(s.commit.mock.calls[0][0].locator.totalProgression).toBe(0.1);
    expect(s.navigation.history.entries).toHaveLength(1);
  });
  it("keeps only the latest queued jump and adds no failed/cancelled entries", async () => {
    const gate = deferred();
    const s = session();
    s.engine.goTo.mockImplementationOnce(async (_target, owner) => {
      await gate.promise;
      s.arrive(0.4, owner?.id);
    });
    const a = s.navigation.navigate({ fraction: 0.4 }, { source: "goto" });
    const b = s.navigation.navigate({ fraction: 0.6 }, { source: "goto" });
    const c = s.navigation.navigate({ fraction: 0.8 }, { source: "goto" });
    expect(await b).toBeNull();
    gate.resolve();
    await a;
    await c;
    expect(s.commit).toHaveBeenCalledOnce();
    expect(
      s.navigation.history.entries.map(
        (entry) => entry.locator.totalProgression,
      ),
    ).toEqual([0, 0.8]);
    s.engine.goTo.mockRejectedValueOnce(new Error("missing chapter"));
    await expect(
      s.navigation.navigate({ fraction: 0.9 }, { source: "contents" }),
    ).rejects.toThrow("missing chapter");
    expect(s.navigation.history.entries).toHaveLength(2);
  });
  it("closing during movement or its paint suppresses every publication", async () => {
    const gate = deferred();
    const s = session(() => gate.promise);
    const move = s.navigation.navigate({ fraction: 1 }, { source: "edge" });
    await microtasks();
    s.navigation.destroy();
    gate.resolve();
    await move;
    s.arrive(1, 1);
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.navigation.history.cursor).toBe(0);
  });
  it("commits Back only when painted, decorates the saved origin, and keeps forward after a turn", async () => {
    const s = session();
    await s.navigation.navigate(
      { fraction: 0.8 },
      { source: "link", originMark: "clicked link" },
    );
    await s.navigation.historyStep(-1);
    expect(s.engine.setDecorations).toHaveBeenCalledWith("history", [
      { cfi: "clicked link", color: "link" },
    ]);
    s.engine.next.mockImplementation(async (owner) =>
      s.arrive(0.1, owner?.id, "turn"),
    );
    await s.navigation.turn("next");
    expect(s.navigation.history.forward?.locator.totalProgression).toBe(0.8);
    expect(s.interrupt).toHaveBeenCalledTimes(2);
    await s.navigation.navigate({ fraction: 0.6 }, { source: "bookmark" });
    expect(s.navigation.history.forward).toBeNull();
  });
  it("boundary turns with no relocate remain silent", async () => {
    const s = session();
    s.engine.prev.mockImplementation(async () => {});
    expect(await s.navigation.turn("prev")).toBeNull();
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.interrupt).not.toHaveBeenCalled();
  });
});
describe("bounded jump history", () => {
  it("coalesces a search chain while retaining its single origin", () => {
    const history = new ReaderHistory();
    history.start(at(0));
    history.push(at(0), at(0.2), "search", "origin");
    history.push(at(0.2), at(0.5), "search");
    expect(
      history.entries.map((entry) => entry.locator.totalProgression),
    ).toEqual([0, 0.5]);
    expect(history.back?.originMark).toBe("origin");
    history.turn(at(0.6));
    history.push(at(0.6), at(0.8), "search");
    expect(history.entries).toHaveLength(3);
  });
  it("bounds each open to 100 entries", () => {
    const history = new ReaderHistory();
    history.start(at(0));
    for (let n = 1; n < 120; n++)
      history.push(at((n - 1) / 120), at(n / 120), "chapter");
    expect(history.entries).toHaveLength(100);
    expect(history.cursor).toBe(99);
  });
});
