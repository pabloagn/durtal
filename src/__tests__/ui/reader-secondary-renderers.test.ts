// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, Component, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReaderRuntime } from "@/lib/reader/runtime";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ Toaster: () => null, toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/actions/reading", () => ({ getRunningTimer: vi.fn(), startTimer: vi.fn(), pauseTimer: vi.fn(), resumeTimer: vi.fn(), discardTimer: vi.fn() }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipLayer: () => null }));
const control = vi.hoisted(() => ({ paletteCrash: true, timerCrash: true, wait: null as Promise<void> | null }));
vi.mock("@/components/reader/catalogue-commands", () => ({ ReaderCatalogueCommands: ({ open, close }: { open: boolean; close(): void }) => {
  if (!open) return null;
  if (control.paletteCrash) throw new Error("Palette renderer crashed");
  if (control.wait) throw control.wait;
  return h(Dialog, { open, onClose: close, title: "Recovered palette", children: h("p", null, "Palette ready") });
} }));
vi.mock("@/components/reading/timer-chip", () => ({ TimerAlerts: () => {
  const timer = useTimer();
  if (control.timerCrash) throw new Error("Timer renderer crashed");
  if (control.wait) throw control.wait;
  return h(Dialog, { open: true, onClose: () => timer.setDiscarding(false), title: "Recovered timer", children: h("p", null, "Timer ready") });
} }));
import { ReaderRuntimeProvider } from "@/components/reader/runtime-provider";
import { useTimer } from "@/components/reading/timer-provider";
import { READER_COMMAND_EVENT } from "@/lib/ui/reader-command";
import { Dialog } from "@/components/ui/dialog";
import { handleSurfaceEscape, hasOpenSurface } from "@/lib/ui/surface-state";
class ReaderSegmentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? h("p", { "data-whole-reader-error": "" }, "Whole reader error") : this.props.children; }
}
const runtime: ReaderRuntime = { status: "ready", value: { version: 1, readingTimerCheckMinutes: 137, readingHome: null, runningTimer: {
  sessionId: "t1", readingId: "r1", workId: "w1", title: "Book", slug: null, author: null, cover: null,
  startedAt: new Date(Date.now() - 60_000).toISOString(), pausedAt: null, pausedSeconds: 0,
  readOn: "2026-10-09", timeZone: "Europe/Amsterdam", status: "reading", unit: "pages", format: "print", editionId: null,
  totalPages: 200, totalMinutes: null, position: { page: 10, percent: null, minutes: null }, fingerprint: "a".repeat(32),
} } };
let timer: ReturnType<typeof useTimer>;
function Reader() { timer = useTimer(); return h("p", { "data-reader-content": "" }, "Book content"); }
let root: Root; let host: HTMLElement; let opener: HTMLButtonElement;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
beforeEach(() => {
  control.paletteCrash = true; control.timerCrash = true; control.wait = null;
  opener = document.createElement("button"); document.body.append(opener); opener.focus();
});
afterEach(() => { act(() => root.unmount()); host.remove(); opener.remove(); vi.restoreAllMocks(); });
describe("deferred secondary feature failures stay isolated", () => {
  it.each(["palette", "timer"])("keeps the reader available when the %s renderer throws", async (feature) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(h(ReaderSegmentBoundary, null, h(ReaderRuntimeProvider, { runtime, children: h(Reader) }))));
    await act(async () => {
      if (feature === "palette") window.dispatchEvent(new Event(READER_COMMAND_EVENT));
      else timer.setDiscarding(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.querySelector("[data-reader-content]"), host.innerHTML).not.toBeNull();
    expect(host.querySelector("[data-whole-reader-error]")).toBeNull();
    expect(host.querySelector('dialog[aria-label="Reading action unavailable"][open]')).not.toBeNull();
    expect(hasOpenSurface()).toBe(true);
    const book = host.querySelector("[data-reader-content]");
    control.paletteCrash = false; control.timerCrash = false;
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.querySelector("[data-reader-content]")).toBe(book);
    expect(host.textContent).toContain(feature === "palette" ? "Palette ready" : "Timer ready");
    expect(hasOpenSurface()).toBe(true);
    await act(async () => { handleSurfaceEscape(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })); await Promise.resolve(); });
    expect(host.querySelector("[data-reader-content]")).toBe(book);
    expect(hasOpenSurface()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it.each(["palette", "timer"])("ignores a suspended %s retry after Close without leaking a surface", async (feature) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(h(ReaderSegmentBoundary, null, h(ReaderRuntimeProvider, { runtime, children: h(Reader) }))));
    const book = host.querySelector("[data-reader-content]");
    await act(async () => {
      if (feature === "palette") window.dispatchEvent(new Event(READER_COMMAND_EVENT)); else timer.setDiscarding(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    let resolve!: () => void;
    control.wait = new Promise<void>((yes) => { resolve = yes; });
    control.paletteCrash = false; control.timerCrash = false;
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click();
      await new Promise((yes) => setTimeout(yes, 10));
    });
    expect(host.querySelector('dialog[aria-label="Loading reading action"][open]')).not.toBeNull();
    await act(async () => {
      handleSurfaceEscape(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      control.wait = null; resolve(); await new Promise((yes) => setTimeout(yes, 10));
    });
    expect(host.querySelector("[data-reader-content]")).toBe(book);
    expect(hasOpenSurface()).toBe(false);
    expect(host.textContent).not.toContain(feature === "palette" ? "Palette ready" : "Timer ready");
  });
});
