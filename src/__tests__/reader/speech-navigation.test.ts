import { describe, expect, it, vi } from "vitest";
import { createReaderNavigation } from "@/lib/reader/navigation";
import type { EngineEvents } from "@/lib/reader/engine";
import { fakeEngine } from "./fixtures/fake-engine";
const relocation = (fraction: number): EngineEvents["relocate"] => ({
  locator: {
    v: 1,
    fileHash: "a".repeat(64),
    href: "chapter",
    sectionIndex: 0,
    progression: fraction,
    totalProgression: fraction,
    cfi: `cfi${fraction}`,
  },
  reason: "jump",
  origin: "human",
  chapter: "Chapter",
  atEnd: fraction === 1,
  activity: "turn",
  tocItem: null,
  visibleChars: 300,
  linear: true,
  paginated: true,
});
function setup(paint = async (_signal: AbortSignal) => {}) {
  const { engine } = fakeEngine();
  const commit = vi.fn(),
    beforeHuman = vi.fn();
  const nav = createReaderNavigation({ engine, commit, beforeHuman, paint });
  let current = relocation(0);
  engine.currentLocator = () => current.locator;
  engine.goTo.mockImplementation(async (target, owner) => {
    current = {
      ...relocation("v" in target ? target.totalProgression : 0),
      navigationId: owner?.id,
      origin: owner?.origin,
    };
    nav.relocate(current);
  });
  nav.start(current);
  return { nav, engine, commit, beforeHuman };
}
describe("owned automatic speech navigation", () => {
  it("publishes only after paint, saves an automatic origin, and never pushes human jump history or EOF", async () => {
    let resolve!: () => void;
    const barrier = new Promise<void>((done) => (resolve = done));
    const s = setup(async () => barrier);
    const pending = s.nav.speechTo(relocation(1).locator);
    await Promise.resolve();
    expect(s.commit).not.toHaveBeenCalled();
    resolve();
    await pending;
    expect(s.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "speech",
        atEnd: false,
        activity: undefined,
      }),
    );
    expect(s.nav.history.back).toBeNull();
    expect(s.beforeHuman).not.toHaveBeenCalled();
    expect(s.engine.goTo.mock.calls[0][1]?.origin).toBe("speech");
  });
  it("human navigation takes ownership and canceled speech cannot publish a late result", async () => {
    const s = setup();
    await s.nav.speechTo(relocation(0.4).locator);
    s.commit.mockClear();
    await s.nav.navigate(relocation(0.7).locator, { source: "goto" });
    expect(s.beforeHuman).toHaveBeenCalledOnce();
    expect(s.commit).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "human" }),
    );
    const old = s.engine.goTo.mock.calls[0][1]!;
    s.commit.mockClear();
    s.nav.relocate({
      ...relocation(0.9),
      origin: "speech",
      navigationId: old.id,
    });
    await Promise.resolve();
    expect(s.commit).not.toHaveBeenCalled();
  });
});
