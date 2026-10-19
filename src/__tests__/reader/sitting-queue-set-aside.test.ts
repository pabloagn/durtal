// @vitest-environment happy-dom
// One saved sitting that no longer reads stopped the queue, so tracking went
// off for that book on that device for good and the sittings beside it were
// never sent. It is set aside under a recovery key, kept, and the rest load
// and send (SLN-1231). The tracker's failure surface, built on the server,
// reached the client as a lazy node that cloneElement turned into an
// undefined element; it shows, with its Retry.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReaderSittingQueue, READER_SITTING_RECOVERY_PREFIX } from "@/lib/reading/reader-sitting-queue";
import type { ReaderSittingWire } from "@/lib/reading/reader-controller";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { ReaderTrackingFailure } from "@/components/reading/reader-tracking";
import { id, locator } from "./fixtures/annotation";

vi.mock("@/lib/actions/reader-tracking", () => ({ saveReaderQuote: vi.fn(), getReaderTracking: vi.fn(), prepareReaderQuoteDelete: vi.fn(), startReaderReading: vi.fn() }));
vi.mock("@/lib/actions/catalogue-client", () => ({ deleteReading: vi.fn(), pauseReading: vi.fn(), resumeReading: vi.fn() }));

const ebookId = id(2), deviceId = id(4);
const prefix = `durtal:tracker:v1:${deviceId}:${ebookId}:`;
const sitting = (n: number, more: Record<string, unknown> = {}): ReaderSittingWire & Record<string, unknown> => ({
  sittingId: id(20 + n), readingId: id(8), revision: 1, startedAt: `2026-10-19T08:0${n}:00.000Z`, endedAt: `2026-10-19T08:0${n}:30.000Z`,
  activeSeconds: 20, startPercent: n, endPercent: n + 1, endChapter: null, timeZone: "UTC", ...more,
});
const ack = (item: ReaderSittingWire) => new Response(JSON.stringify({ sittingId: item.sittingId, revision: item.revision, status: "saved" }),
  { headers: { "content-type": "application/json" } });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("saved sittings that no longer read (SLN-1231)", () => {
  const open = (setAside = vi.fn(), storage: Storage = localStorage) => {
    const sent: ReaderSittingWire[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => { const item = JSON.parse(String(init.body)); sent.push(item); return ack(item); });
    const queue = createReaderSittingQueue({ ebookId, deviceId, timeZone: "UTC", storage, fetch: fetch as unknown as typeof globalThis.fetch,
      failed: vi.fn(), retired: vi.fn(), setAside });
    return { queue, sent, setAside };
  };

  it("sets one aside under the recovery key, and loads and sends the rest", async () => {
    localStorage.setItem(prefix + id(21), JSON.stringify(sitting(1)));
    localStorage.setItem(prefix + id(30), JSON.stringify({ sittingId: id(30), revision: "two" }));
    localStorage.setItem(prefix + id(22), JSON.stringify(sitting(2)));
    const { queue, sent, setAside } = open();
    expect(queue.pending).toBe(2);
    expect(setAside).toHaveBeenCalledWith(1);
    // Kept, word for word, where the queue won't read it again
    expect(localStorage.getItem(`${READER_SITTING_RECOVERY_PREFIX}${deviceId}:${ebookId}:${id(30)}`)).toBe(JSON.stringify({ sittingId: id(30), revision: "two" }));
    expect(localStorage.getItem(prefix + id(30))).toBeNull();
    await queue.flush();
    expect(sent.map((s) => s.sittingId).sort()).toEqual([id(21), id(22)]);
    expect(queue.pending).toBe(0);
    // The next visit reads cleanly
    expect(open().setAside).not.toHaveBeenCalled();
  });

  it("reads a sitting with a field this release no longer sends", async () => {
    localStorage.setItem(prefix + id(21), JSON.stringify(sitting(1, { device: "phone" })));
    const { queue, sent, setAside } = open();
    expect(setAside).not.toHaveBeenCalled();
    await queue.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty("device");
  });

  it("sends a set-aside sitting once this release reads it, and leaves one that still doesn't", async () => {
    const keep = (key: string, text: string) => localStorage.setItem(`${READER_SITTING_RECOVERY_PREFIX}${deviceId}:${ebookId}:${key}`, text);
    // Set aside by another release; this one reads it
    keep(id(23), JSON.stringify(sitting(3)));
    keep(id(31), JSON.stringify({ sittingId: id(31), revision: "two" }));
    const { queue, sent, setAside } = open();
    expect(setAside).not.toHaveBeenCalled();
    expect(queue.pending).toBe(1);
    expect(localStorage.getItem(`${READER_SITTING_RECOVERY_PREFIX}${deviceId}:${ebookId}:${id(23)}`)).toBeNull();
    await queue.flush();
    expect(sent.map((s) => s.sittingId)).toEqual([id(23)]);
    expect(localStorage.getItem(prefix + id(23))).toBeNull();
    // The unreadable one stays, and isn't counted again
    expect(localStorage.getItem(`${READER_SITTING_RECOVERY_PREFIX}${deviceId}:${ebookId}:${id(31)}`)).not.toBeNull();
    expect(open().setAside).not.toHaveBeenCalled();
  });

  it("keeps loading when the recovery key can't be written", () => {
    localStorage.setItem(prefix + id(21), JSON.stringify(sitting(1)));
    localStorage.setItem(prefix + id(30), "{not json");
    const full = new Proxy(localStorage, { get: (target, key) => key === "setItem" ? () => { throw new DOMException("full", "QuotaExceededError"); }
      : typeof Reflect.get(target, key) === "function" ? Reflect.get(target, key).bind(target) : Reflect.get(target, key) });
    const { queue, setAside } = open(vi.fn(), full);
    expect(queue.pending).toBe(1);
    expect(setAside).toHaveBeenCalledWith(1);
    // Still there, set aside again next time rather than lost
    expect(localStorage.getItem(prefix + id(30))).toBe("{not json");
  });
});

describe("the tracker's failure surface (SLN-1231)", () => {
  it("shows with its Retry when it arrives as a lazy node", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const failure = h(ReaderTrackingFailure, { id: "reading-tracker", code: "reader_controller_unavailable" });
    // How a server-built element can reach the client: a lazy node around it
    const lazy = { $$typeof: Symbol.for("react.lazy"), _payload: failure, _init: (node: unknown) => node } as unknown as typeof failure;
    const retry = vi.fn();
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root.render(h(ReaderBridgeProvider, { context: { ebookId, fileId: id(3), format: "epub", locator, percent: 10, chapter: null, selection: null },
        requiredControllerIds: ["reading-tracker"], onRetry: retry,
        plugins: [{ id: "reading-tracker", controller: true, failure: "reader_controller_load_failed", failureNode: lazy, node: null }],
        children: () => null }));
    });
    expect(host.textContent).toContain("Reading tracking is unavailable");
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry tracking");
    expect(button).toBeTruthy();
    await act(async () => { button!.click(); });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/crashed|Element type is invalid/);
    await act(async () => root.unmount()); host.remove();
  });
});
