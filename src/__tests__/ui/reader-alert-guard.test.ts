// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReaderRuntime } from "@/lib/reader/runtime";
const loading = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
});
vi.mock("@/lib/actions/reading", () => ({ getRunningTimer: vi.fn(), pauseTimer: vi.fn(), resumeTimer: vi.fn(), startTimer: vi.fn(), discardTimer: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() }, Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipLayer: () => null }));
vi.mock("@/components/reading/timer-chip", async () => {
  await loading.promise;
  const { Dialog } = await import("@/components/ui/dialog");
  return { TimerAlerts: () => {
    const timer = useTimer();
    return h(Dialog, { open: true, title: "Timer confirmation", onClose: () => timer.setDiscarding(false), children: h("p", null, "Loaded timer controls") });
  } };
});
import { ReaderRuntimeProvider } from "@/components/reader/runtime-provider";
import { useTimer } from "@/components/reading/timer-provider";
import { handleSurfaceEscape, hasOpenSurface } from "@/lib/ui/surface-state";
const runtime: ReaderRuntime = { status: "ready", value: {
  version: 1, readingTimerCheckMinutes: 137, readingHome: null,
  runningTimer: {
    sessionId: "t1", readingId: "r1", workId: "w1", title: "Nadja", slug: null, author: null, cover: null,
    startedAt: new Date(Date.now() - 60_000).toISOString(), pausedAt: null, pausedSeconds: 0,
    readOn: "2026-10-09", timeZone: "Europe/Amsterdam", status: "reading", unit: "pages", format: "print", editionId: null,
    totalPages: 200, totalMinutes: null, position: { page: 10, percent: null, minutes: null }, fingerprint: "a".repeat(32),
  },
} };
let root: Root; let host: HTMLElement; let timer: ReturnType<typeof useTimer>;
function Consumer() { timer = useTimer(); return null; }
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function mount() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(h(ReaderRuntimeProvider, { runtime, children: h(Consumer) })));
}
describe("lazy reader timer alert guards", () => {
  it("blocks input at invocation and discards a renderer that finishes after Escape", async () => {
    mount();
    act(() => { timer.setDiscarding(true); expect(hasOpenSurface()).toBe(true); });
    expect(host.textContent).toContain("Loading reading action");
    act(() => { handleSurfaceEscape(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })); });
    await act(async () => { loading.resolve(); await import("@/components/reading/timer-chip"); });
    expect(timer.discarding).toBe(false); expect(hasOpenSurface()).toBe(false);
    expect(host.textContent).not.toContain("Loaded timer controls");
  });
  it("transfers guard ownership to the native dialog when its renderer is ready", async () => {
    mount();
    await act(async () => { timer.setDiscarding(true); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.textContent).toContain("Loaded timer controls"); expect(hasOpenSurface()).toBe(true);
    act(() => { handleSurfaceEscape(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })); });
    await act(async () => { await Promise.resolve(); });
    expect(timer.discarding).toBe(false); expect(hasOpenSurface()).toBe(false);
  });
});
