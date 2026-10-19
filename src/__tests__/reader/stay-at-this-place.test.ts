// @vitest-environment happy-dom
// "Stay at this place" holds for the tab's visit: a reload doesn't offer the
// jump to the logged place again, and a later logged place does (SLN-1179).
// Server actions are fixtures; a reload is a fresh mount in the same tab.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { ReaderTracking, ReaderTrackingFailure } from "@/components/reading/reader-tracking";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import { id, locator } from "./fixtures/annotation";

vi.mock("@/lib/actions/reader-tracking", () => ({ saveReaderQuote: vi.fn(),
  getReaderTracking: vi.fn(), prepareReaderQuoteDelete: vi.fn(), startReaderReading: vi.fn() }));
vi.mock("@/lib/actions/catalogue-client", () => ({ deleteReading: vi.fn(), pauseReading: vi.fn(), resumeReading: vi.fn() }));
vi.mock("@/components/reading/timer-provider", () => ({ useOptionalTimer: () => ({ availability: "ready", known: true, timer: null }) }));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({ open: vi.fn() }) }));

const data = (percent: number, readingId = id(8)) => ({ version: 1 as const, ebookId: id(2), deviceId: id(4), autoTrack: true,
  dayStartHour: 4, estimate: null, linked: { workId: id(5), title: "Tracking test", editionId: id(6),
    instanceId: id(7), hasClosedHistory: false, reading: { id: readingId, fingerprint: "a".repeat(32), status: "reading" as const,
      unit: "percent" as const, percent, page: null, totalPages: 300, chapter: null } } });

let root: Root | null = null, host: HTMLElement, status: HTMLElement;
const frame = () => new Promise((done) => setTimeout(done, 40));
// The reader opens at 10%, behind the logged place
async function open(tracking: ReturnType<typeof data>) {
  if (root) await act(async () => root!.unmount());
  host.replaceChildren(); status = document.createElement("div"); host.append(status);
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(h(ReaderBridgeProvider, { context: { ebookId: id(2), fileId: id(3), format: "epub",
      locator, percent: 10, chapter: null, selection: null }, requiredControllerIds: ["reading-tracker"],
      plugins: [{ id: "reading-tracker", controller: true, failureNode: h(ReaderTrackingFailure, { id: "reading-tracker", code: "reader_controller_failed" }),
        node: h(ReaderTracking, { data: tracking }) }],
      children: (owner: ReaderBridgeController) => { owner.mountSlot("toolbar-status", status); return null; } }));
    await frame();
  });
}
const stay = () => status.querySelector<HTMLButtonElement>('button[aria-label="Stay at this place"]');
const offered = () => !!status.querySelector('button[aria-label^="Jump to"]');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); localStorage.clear();
  const save = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", save);
  window.fetch = save as unknown as typeof fetch;
  host = document.createElement("div"); document.body.append(host);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null; host.remove(); sessionStorage.clear(); localStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('"Stay at this place" in the reader (SLN-1179)', () => {
  it("keeps the jump away after a reload, until a later place is logged", async () => {
    await open(data(50));
    expect(offered()).toBe(true);
    await act(async () => { stay()!.click(); await frame(); });
    expect(offered()).toBe(false);
    // A reload in the same tab
    await open(data(50));
    expect(offered()).toBe(false);
    // A later log, then a reload
    await open(data(60));
    expect(offered()).toBe(true);
  });

  it("asks again for another reading", async () => {
    await open(data(50));
    await act(async () => { stay()!.click(); await frame(); });
    await open(data(50, id(9)));
    expect(offered()).toBe(true);
  });

  it("still dismisses for the visit when storage is blocked", async () => {
    // As with blocked site data, reaching the storage throws
    const blocked = { get: () => { throw new DOMException("blocked", "SecurityError"); } };
    const kept = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, ...blocked });
    try {
      await open(data(50));
      expect(offered()).toBe(true);
      await act(async () => { stay()!.click(); await frame(); });
      expect(offered()).toBe(false);
      // Nothing kept: a reload offers it, as before
      await open(data(50));
      expect(offered()).toBe(true);
    } finally {
      if (kept) Object.defineProperty(globalThis, "sessionStorage", kept);
      else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    }
  });
});
