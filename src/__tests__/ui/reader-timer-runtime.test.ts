// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RunningTimer } from "@/lib/reading/timer-service";

const actions = vi.hoisted(() => ({ getRunningTimer: vi.fn(), pauseTimer: vi.fn(), resumeTimer: vi.fn(), startTimer: vi.fn(), discardTimer: vi.fn() }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/reading", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { error: toastError, success: vi.fn(), message: vi.fn(), info: vi.fn() } }));
import { TimerProvider, useTimer } from "@/components/reading/timer-provider";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const running: RunningTimer = {
  sessionId: "t1", readingId: "r1", workId: "w1", title: "Nadja", slug: "nadja", author: null, cover: null,
  startedAt: new Date(Date.now() - 60_000).toISOString(), pausedAt: null, pausedSeconds: 0,
  readOn: "2026-10-09", timeZone: "Europe/Amsterdam", status: "reading", unit: "pages", format: "print", editionId: null,
  totalPages: 200, totalMinutes: null, position: { page: 10, percent: null, minutes: null }, fingerprint: "a".repeat(32),
};
let root: Root;
let host: HTMLElement;
let timer: ReturnType<typeof useTimer>;
function Consumer() { timer = useTimer(); return null; }
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.clearAllMocks();
  actions.getRunningTimer.mockResolvedValue(running);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(h(TimerProvider, { initial: { timer: running, checkMinutes: 137 }, children: h(Consumer) })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("reader timer bootstrap and concurrent refreshes", () => {
  it("uses the real seeded interval and does not query again on mount", () => {
    expect(timer.checkMinutes).toBe(137);
    expect(timer.timer).toEqual(running);
    expect(timer.availability).toBe("ready");
    expect(actions.getRunningTimer).not.toHaveBeenCalled();
  });

  it("coalesces simultaneous callers and focus refreshes", async () => {
    const read = deferred<RunningTimer | null>(); actions.getRunningTimer.mockReturnValueOnce(read.promise);
    let first!: Promise<RunningTimer | null>; let second!: Promise<RunningTimer | null>;
    act(() => { first = timer.refresh(); second = timer.refresh(); window.dispatchEvent(new Event("focus")); });
    expect(first).toBe(second); expect(actions.getRunningTimer).toHaveBeenCalledTimes(1);
    await act(async () => { read.resolve(running); await first; await second; });
  });

  it("keeps failed reads distinct from a confirmed absent timer and disables writes", async () => {
    actions.getRunningTimer.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await expect(timer.refresh()).rejects.toThrow("offline"); });
    expect(timer.availability).toBe("unavailable"); expect(timer.timer?.sessionId).toBe("t1");
    await act(async () => { await timer.pause(); });
    expect(actions.pauseTimer).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalledWith("This timer was stopped on another device");
    expect(host.querySelector("[data-timer-unavailable]")).not.toBeNull();
  });

  it("does not let a pre-mutation read overwrite pause and shares one post-mutation read", async () => {
    const old = deferred<RunningTimer | null>(); const write = deferred<RunningTimer>();
    const paused = { ...running, pausedAt: new Date().toISOString() };
    actions.getRunningTimer.mockReturnValueOnce(old.promise).mockResolvedValue(paused);
    actions.pauseTimer.mockReturnValueOnce(write.promise);
    let reading!: Promise<RunningTimer | null>; let pausing!: Promise<void>;
    act(() => { reading = timer.refresh(); pausing = timer.pause(); });
    await act(async () => { old.resolve(running); await Promise.resolve(); });
    await act(async () => { write.resolve(paused); await pausing; await reading; });
    expect(timer.timer?.pausedAt).toBe(paused.pausedAt);
    expect(actions.getRunningTimer).toHaveBeenCalledTimes(2);
  });
});
