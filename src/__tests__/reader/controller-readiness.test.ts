import { afterEach, describe, expect, it, vi } from "vitest";
import { createControllerReadiness, type ReaderControllerHandlers } from "@/lib/reader/controller-readiness";
import { createReaderEventBus } from "@/lib/reader/events";
import { place } from "./fixtures/places";

afterEach(() => vi.useRealTimers());
function setup(ids = ["test-controller"]) {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  const bus = createReaderEventBus({
    hidden: () => false, now: () => 100,
    frame: (fn) => { frames.set(++sequence, fn); return sequence; },
    cancelFrame: (id) => { frames.delete(id); },
    microtask: (fn) => fn(),
  });
  const gate = createControllerReadiness(bus, ids);
  const handlers = { activity: vi.fn(), location: vi.fn(), end: vi.fn(), selection: vi.fn() };
  const flush = () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(0));
  };
  const first = () => {
    bus.activity("key");
    bus.location({ kind: "jump", chapter: null, fileId: "file", locator: place().locator, atEnd: true });
    bus.emit("selection", null);
  };
  return { gate, bus, handlers, flush, first };
}
describe("generation-scoped functional controller readiness", () => {
  it("admits an empty registry immediately after provider activation", async () => {
    const s = setup([]); s.gate.start();
    const permit = await s.gate.whenReady(new AbortController().signal);
    expect(s.gate.isPermitCurrent(permit)).toBe(true);
    s.gate.destroy(); expect(s.gate.isPermitCurrent(permit)).toBe(false);
  });
  it("requires all four atomic subscribers and every configured ID", async () => {
    const s = setup(["a", "b"]); s.gate.start();
    let settled = false;
    const pending = s.gate.whenReady(new AbortController().signal).then(() => { settled = true; });
    const installed = vi.spyOn(s.bus, "on");
    s.gate.install("a", s.handlers);
    expect(installed.mock.calls.map(([event]) => event)).toEqual(["activity", "location", "end", "selection"]);
    await Promise.resolve(); expect(settled).toBe(false);
    const other = { activity: vi.fn(), location: vi.fn(), end: vi.fn(), selection: vi.fn() };
    s.gate.install("b", other); await pending;
    s.first(); s.flush();
    for (const handler of [...Object.values(s.handlers), ...Object.values(other)]) expect(handler).toHaveBeenCalledOnce();
    s.gate.destroy();
  });
  it("waits for provider activation even if the layout controller installed first", async () => {
    const s = setup(); s.gate.install("test-controller", s.handlers);
    let settled = false;
    const wait = s.gate.whenReady(new AbortController().signal).then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    s.gate.start(); await wait; expect(settled).toBe(true); s.gate.destroy();
  });
  it("rolls back partial subscriptions without acknowledging readiness", () => {
    const s = setup(); s.gate.start();
    expect(() => s.gate.install("test-controller", { ...s.handlers, end: null } as unknown as ReaderControllerHandlers)).toThrow("Missing");
    s.first(); s.flush();
    Object.values(s.handlers).forEach((handler) => expect(handler).not.toHaveBeenCalled());
    expect(s.gate.getSnapshot().ready).toBe(false); s.gate.destroy();
  });
  it("rejects unknown and duplicate live controllers", () => {
    const s = setup(); s.gate.start();
    expect(() => s.gate.install("other", s.handlers)).toThrow("Unconfigured");
    s.gate.install("test-controller", s.handlers);
    expect(() => s.gate.install("test-controller", s.handlers)).toThrow("Duplicate"); s.gate.destroy();
  });
  it("bounds a missing controller without pretending failure is visible", async () => {
    vi.useFakeTimers(); const s = setup(); s.gate.start();
    let settled = false;
    const wait = s.gate.whenReady(new AbortController().signal).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.gate.getSnapshot().controllers[0]).toMatchObject({ status: "failed", code: "reader_controller_timeout" });
    expect(settled).toBe(false);
    expect(() => s.gate.install("test-controller", s.handlers)).toThrow("retry");
    const revoke = s.gate.visibleFailure("test-controller", "reader_controller_timeout", s.gate.getSnapshot().epoch);
    await wait; expect(settled).toBe(true);
    revoke(); expect(s.gate.getSnapshot().ready).toBe(false); s.gate.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels one waiter independently without cancelling another", async () => {
    const s = setup(); s.gate.start(); const abort = new AbortController();
    const old = s.gate.whenReady(abort.signal); const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    const current = s.gate.whenReady(new AbortController().signal); abort.abort(); await rejected;
    s.gate.install("test-controller", s.handlers); expect(s.gate.isPermitCurrent(await current)).toBe(true); s.gate.destroy();
  });
  it("rejects replaced generations and ignores their late acknowledgements", async () => {
    const s = setup(); s.gate.start(); const epoch = s.gate.getSnapshot().epoch;
    const old = s.gate.whenReady(new AbortController().signal); const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    s.gate.destroy(); await rejected;
    s.gate.install("test-controller", s.handlers); s.gate.start();
    s.gate.fail("test-controller", "reader_controller_failed", epoch);
    s.gate.visibleFailure("test-controller", "reader_controller_failed", epoch);
    expect(s.gate.getSnapshot().controllers[0].status).toBe("ready"); s.gate.destroy();
  });
  it("invalidates resolved permits on withdrawal and keeps replacement leases", async () => {
    const s = setup(); s.gate.start(); const off = s.gate.install("test-controller", s.handlers);
    const permit = await s.gate.whenReady(new AbortController().signal); off();
    expect(s.gate.isPermitCurrent(permit)).toBe(false);
    s.gate.install("test-controller", s.handlers); off();
    expect(s.gate.getSnapshot().ready).toBe(true); s.first(); s.flush();
    Object.values(s.handlers).forEach((handler) => expect(handler).toHaveBeenCalledOnce()); s.gate.destroy();
  });
  it("fences queued old events and resets first/end/activity on StrictMode restart", () => {
    const s = setup(); s.gate.install("test-controller", s.handlers); s.gate.start(); s.first();
    s.gate.destroy(); s.flush(); Object.values(s.handlers).forEach((handler) => expect(handler).not.toHaveBeenCalled());
    s.gate.install("test-controller", s.handlers); s.gate.start(); s.first(); s.flush();
    Object.values(s.handlers).forEach((handler) => expect(handler).toHaveBeenCalledOnce());
    expect(s.handlers.location.mock.calls[0][0].kind).toBe("jump"); s.gate.destroy();
  });
  it("a synchronous functional-handler error withdraws readiness and cannot keep tracking", () => {
    const s = setup(); s.gate.start();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    s.gate.install("test-controller", { ...s.handlers, activity: () => { throw new Error("controller failed"); } });
    s.first(); s.flush();
    expect(s.gate.getSnapshot().ready).toBe(false);
    expect(s.gate.getSnapshot().controllers[0]).toMatchObject({ status: "failed", code: "reader_controller_failed" });
    expect(s.handlers.location).not.toHaveBeenCalled();
    s.gate.destroy(); error.mockRestore();
  });
  it("repeated failure reporting cannot discard the visible failure cleanup token", () => {
    const s = setup(); s.gate.start(); const epoch = s.gate.getSnapshot().epoch;
    s.gate.fail("test-controller", "reader_controller_failed", epoch);
    const revoke = s.gate.visibleFailure("test-controller", "reader_controller_failed", epoch);
    s.gate.fail("test-controller", "reader_controller_failed", epoch);
    expect(s.gate.getSnapshot().ready).toBe(true);
    revoke(); expect(s.gate.getSnapshot().ready).toBe(false); s.gate.destroy();
  });
  it("keeps loader failure configured until visible failure acknowledgement", async () => {
    const s = setup(); const gate = createControllerReadiness(s.bus, ["a"], { a: "reader_controller_load_failed" });
    gate.start(); expect(gate.getSnapshot().ready).toBe(false);
    gate.visibleFailure("a", "reader_controller_failed", gate.getSnapshot().epoch);
    expect(gate.getSnapshot().ready).toBe(false);
    gate.visibleFailure("a", "reader_controller_load_failed", gate.getSnapshot().epoch);
    expect(gate.isPermitCurrent(await gate.whenReady(new AbortController().signal))).toBe(true); gate.destroy();
  });
});
