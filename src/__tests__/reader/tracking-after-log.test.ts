// @vitest-environment happy-dom
// A log, edit or finish saved in the reader retires its sitting on the server;
// the reading after it goes in a fresh sitting rather than the retired one,
// whose later saves the server ignores (SLN-1192). Server actions are fixtures.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { ReaderTracking, ReaderTrackingFailure } from "@/components/reading/reader-tracking";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { ReaderSittingWire } from "@/lib/reading/reader-controller";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { id, locator } from "./fixtures/annotation";

const actions = vi.hoisted(() => ({ tracking: vi.fn() }));
vi.mock("@/lib/actions/reader-tracking", () => ({ saveReaderQuote: vi.fn(),
  getReaderTracking: actions.tracking, prepareReaderQuoteDelete: vi.fn(), startReaderReading: vi.fn() }));
vi.mock("@/lib/actions/catalogue-client", () => ({ deleteReading: vi.fn(), pauseReading: vi.fn(), resumeReading: vi.fn() }));
vi.mock("@/components/reading/timer-provider", () => ({ useOptionalTimer: () => ({ availability: "ready", known: true, timer: null }) }));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({ open: vi.fn() }) }));

const reading = (fingerprint: string, percent: number) => ({ id: id(8), fingerprint, status: "reading" as const, unit: "percent" as const,
  percent, page: null, totalPages: 300, chapter: null });
const data = (fingerprint: string, percent: number) => ({ version: 1 as const, ebookId: id(2), deviceId: id(4), autoTrack: true,
  dayStartHour: 4, estimate: null, linked: { workId: id(5), title: "Tracking test", editionId: id(6),
    instanceId: id(7), hasClosedHistory: false, reading: reading(fingerprint, percent) } });

let root: Root, host: HTMLElement, bridge: ReaderBridgeController, clock: number;
const sent: ReaderSittingWire[] = [];
const frame = () => new Promise((done) => setTimeout(done, 40));
const place = async (percent: number, kind: "turn" | "jump" = "turn") => {
  await act(async () => {
    // The key that turns the page comes before the turn
    bridge.bus.activity("key");
    bridge.bus.location({ locator: { ...locator, totalProgression: percent / 100, cfi: `epubcfi(/6/4!/4/${percent})` },
      kind, chapter: null, fileId: id(3), atEnd: false });
    bridge.bus.activity("turn");
    await frame();
  });
};

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear(); sent.length = 0;
  clock = Date.parse("2026-10-19T09:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const save = vi.fn(async (_url: string, init: RequestInit) => {
    const item = JSON.parse(String(init.body)) as ReaderSittingWire;
    sent.push(item);
    return new Response(JSON.stringify({ sittingId: item.sittingId, revision: item.revision, status: "saved" }),
      { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", save);
  window.fetch = save as unknown as typeof fetch;
  // The closing page's beacon carries the last save
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: (_url: string, body: Blob) => {
    void body.text().then((text) => sent.push(JSON.parse(text) as ReaderSittingWire));
    return true;
  } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => {
    root.render(h(ReaderBridgeProvider, { context: { ebookId: id(2), fileId: id(3), format: "epub",
      locator, percent: 10, chapter: null, selection: null }, requiredControllerIds: ["reading-tracker"],
      plugins: [{ id: "reading-tracker", controller: true, failureNode: h(ReaderTrackingFailure, { id: "reading-tracker", code: "reader_controller_failed" }),
        node: h(ReaderTracking, { data: data("a".repeat(32), 10) }) }],
      children: (owner: ReaderBridgeController) => { bridge = owner; return null; } }));
  });
  expect(bridge.getControllerReadinessSnapshot().ready).toBe(true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("reading on after a log saved in the reader (SLN-1192)", () => {
  it("goes in a fresh sitting from the place the reader is at", async () => {
    await place(10, "jump");
    clock += 4000; await place(12);
    clock += 4000; await place(14);
    // Log progress saves: the server retired the sitting under way
    actions.tracking.mockResolvedValue(data("b".repeat(32), 50));
    await act(async () => { triggerActivityRefresh(); await frame(); });
    clock += 4000; await place(16);
    clock += 4000; await place(18);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); await frame(); });
    // The newest revision of each sitting
    const sittings = [...new Map(sent.map((s) => [s.sittingId, s])).values()];
    expect(sittings.map(({ readingId, startPercent, endPercent, activeSeconds }) => ({ readingId, startPercent, endPercent, activeSeconds }))).toEqual([
      { readingId: id(8), startPercent: 10, endPercent: 14, activeSeconds: 8 },
      { readingId: id(8), startPercent: 14, endPercent: 18, activeSeconds: 4 },
    ]);
  });

  it("saves nothing more once the reading is finished", async () => {
    await place(10, "jump");
    clock += 4000; await place(12);
    actions.tracking.mockResolvedValue({ ...data("b".repeat(32), 100), linked: { ...data("b".repeat(32), 100).linked, reading: null } });
    await act(async () => { triggerActivityRefresh(); await frame(); });
    const saved = sent.length;
    expect(sent.at(-1)).toMatchObject({ startPercent: 10, endPercent: 12 });
    clock += 4000; await place(14);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); await frame(); });
    expect(sent.length).toBe(saved);
  });
});
