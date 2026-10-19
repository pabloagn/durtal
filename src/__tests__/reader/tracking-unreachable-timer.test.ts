// @vitest-environment happy-dom
// The tab was away while the Mac was out of reach. Coming back, the timer
// could not be read, and tracking swapped itself for its failure surface for
// the rest of the visit, so nothing read after that was saved. An unreachable
// timer that has loaded before keeps tracking on; the sittings queue on the
// device, and the timer reads again when the network returns (SLN-1274).
// Server actions are fixtures.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { ReaderTracking, ReaderTrackingFailure } from "@/components/reading/reader-tracking";
import { TimerProvider } from "@/components/reading/timer-provider";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { ReaderSittingWire } from "@/lib/reading/reader-controller";
import { id, locator } from "./fixtures/annotation";

const actions = vi.hoisted(() => ({ running: vi.fn() }));
vi.mock("@/lib/actions/reading", () => ({ getRunningTimer: actions.running }));
vi.mock("@/lib/actions/reader-tracking", () => ({ saveReaderQuote: vi.fn(),
  getReaderTracking: vi.fn(), prepareReaderQuoteDelete: vi.fn(), startReaderReading: vi.fn() }));
vi.mock("@/lib/actions/catalogue-client", () => ({ deleteReading: vi.fn(), pauseReading: vi.fn(), resumeReading: vi.fn(),
  discardTimer: vi.fn(), pauseTimer: vi.fn(), resumeTimer: vi.fn(), startTimer: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({ open: vi.fn() }) }));

const data = { version: 1 as const, ebookId: id(2), deviceId: id(4), autoTrack: true,
  dayStartHour: 4, estimate: null, linked: { workId: id(5), title: "Tracking test", editionId: id(6),
    instanceId: id(7), hasClosedHistory: false, reading: { id: id(8), fingerprint: "a".repeat(32), status: "reading" as const,
      unit: "percent" as const, percent: 10, page: null, totalPages: 300, chapter: null } } };

let root: Root, host: HTMLElement, status: HTMLElement, bridge: ReaderBridgeController, clock: number, reachable: boolean;
const sent: ReaderSittingWire[] = [];
const frame = () => new Promise((done) => setTimeout(done, 40));
const place = async (percent: number) => {
  await act(async () => {
    bridge.bus.activity("key");
    bridge.bus.location({ locator: { ...locator, totalProgression: percent / 100, cfi: `epubcfi(/6/4!/4/${percent})` },
      kind: "turn", chapter: null, fileId: id(3), atEnd: false });
    bridge.bus.activity("turn");
    await frame();
  });
};
const show = async (state: "hidden" | "visible") => {
  await act(async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
    if (state === "visible") window.dispatchEvent(new Event("focus"));
    await frame();
  });
};
const tracking = () => [...host.querySelectorAll("button")].some((b) => b.textContent?.startsWith("Tracking"));
const failure = () => host.textContent?.includes("Reading tracking is unavailable") ?? false;
const timerNotice = () => !!document.querySelector("[data-timer-unavailable]");

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear(); sent.length = 0; reachable = true;
  clock = Date.parse("2026-10-19T09:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  actions.running.mockImplementation(async () => { if (!reachable) throw new TypeError("Failed to fetch"); return null; });
  const save = vi.fn(async (_url: string, init: RequestInit) => {
    if (!reachable) throw new TypeError("Failed to fetch");
    const item = JSON.parse(String(init.body)) as ReaderSittingWire;
    sent.push(item);
    return new Response(JSON.stringify({ sittingId: item.sittingId, revision: item.revision, status: "saved" }),
      { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", save);
  window.fetch = save as unknown as typeof fetch;
  // An unreachable Mac takes the beacon and drops it
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: (_url: string, body: Blob) => {
    if (reachable) void body.text().then((text) => sent.push(JSON.parse(text) as ReaderSittingWire));
    return true;
  } });
  host = document.createElement("div"); document.body.append(host);
  status = document.createElement("div"); host.append(status);
  root = createRoot(host.appendChild(document.createElement("div")));
  await act(async () => {
    root.render(h(TimerProvider, { initial: { timer: null, checkMinutes: 30 }, children: h(ReaderBridgeProvider, {
      context: { ebookId: id(2), fileId: id(3), format: "epub", locator, percent: 10, chapter: null, selection: null },
      requiredControllerIds: ["reading-tracker"],
      plugins: [{ id: "reading-tracker", controller: true, failureNode: h(ReaderTrackingFailure, { id: "reading-tracker", code: "reader_controller_failed" }),
        node: h(ReaderTracking, { data }) }],
      children: (owner: ReaderBridgeController) => { bridge = owner; owner.mountSlot("toolbar-status", status); return null; } }) }));
  });
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); localStorage.clear();
  Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("coming back to the reader while the Mac is out of reach (SLN-1274)", () => {
  it("keeps tracking, and saves what was read once the network returns", async () => {
    await place(8);
    for (let n = 1; n <= 2; n++) { clock += 4_000; await place(8 + n); }
    expect(tracking()).toBe(true);
    // Away, and the Mac out of reach
    reachable = false;
    await show("hidden");
    clock += 60_000;
    await show("visible");
    expect(timerNotice()).toBe(true);
    expect(failure()).toBe(false);
    expect(tracking()).toBe(true);
    // Thirty seconds of reading while it is still out of reach
    for (let n = 1; n <= 6; n++) { clock += 5_000; await place(10 + n); }
    expect(host.textContent).toContain("Retry sync");
    // The network returns: the timer reads again and the sittings go
    reachable = true;
    await act(async () => { window.dispatchEvent(new Event("online")); await frame(); });
    expect(timerNotice()).toBe(false);
    // The failed send's notice goes once a send gets through
    clock += 5_000; await place(17);
    expect(host.textContent).not.toContain("Retry sync");
    await act(async () => { window.dispatchEvent(new Event("pagehide")); await frame(); });
    const after = sent.filter((s) => s.endPercent >= 16);
    expect(after.length).toBeGreaterThan(0);
    expect(Math.max(...after.map((s) => s.activeSeconds))).toBeGreaterThanOrEqual(30);
  });

  it("shows the failure surface when the timer has never loaded", async () => {
    await act(async () => root.unmount());
    reachable = false;
    root = createRoot(host.appendChild(document.createElement("div")));
    await act(async () => {
      root.render(h(TimerProvider, null, h(ReaderBridgeProvider, {
        context: { ebookId: id(2), fileId: id(3), format: "epub", locator, percent: 10, chapter: null, selection: null },
        requiredControllerIds: ["reading-tracker"],
        plugins: [{ id: "reading-tracker", controller: true, failureNode: h(ReaderTrackingFailure, { id: "reading-tracker", code: "reader_controller_failed" }),
          node: h(ReaderTracking, { data }) }],
        children: () => null })));
      await frame();
    });
    expect(failure()).toBe(true);
  });
});
