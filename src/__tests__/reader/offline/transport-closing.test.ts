import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReaderTransport,
  type ReaderTransport,
} from "@/lib/reader/offline/transport";
import { planReplayClaim } from "@/lib/reader/offline/outbox-policy";
import type { OfflineStore, StoredOperation } from "@/lib/reader/offline/store";
import { annotations, DEVICE, itemId, NOW, OTHER, position } from "./fixtures";

/** A delete still in its Undo window, as the reader leaves it in the queue */
function deleting(seq: number, row: Partial<StoredOperation> = {}): StoredOperation {
  return {
    ...annotations(seq, { deleting: true }),
    v: 1,
    retryAt: null,
    annotation: {
      pending: {},
      undo: { state: "undoable", until: NOW + 10_000, snapshot: {} },
    },
    ...row,
  };
}
/** The place of a page turned, as the reader queues it */
function turned(seq: number, progression: number, options: Parameters<typeof position>[2] = {}): StoredOperation {
  return { ...position(seq, progression, options), v: 1, retryAt: null };
}
const never = () => new Promise<never>(() => {});

/** `held`: this page's own replay never gets past its claim, as when the
 * page closes before it does */
function setup(initial: StoredOperation[], { held = false } = {}) {
  let rows = initial;
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const window = Object.assign(new EventTarget(), {
    document,
    navigator: { onLine: true },
  });
  const store = {
    inspect: vi.fn(async () => rows),
    sealDeletes: vi.fn(async () => 0),
    claim: vi.fn(async (options: Parameters<typeof planReplayClaim>[1]) => {
      if (
        options.mode === "foreground" &&
        (held || rows[0]?.annotation?.undo?.state === "undoable")
      )
        return { kind: "stop" as const, reason: "undo_pending" as const };
      return planReplayClaim(rows, options);
    }),
    settle: vi.fn(async () => 0),
    transactBook: vi.fn(
      async (_ebookId: string, reduce: OfflineStore["transactBook"] extends (
        id: string,
        reduce: infer R,
      ) => unknown
        ? R
        : never) => {
        rows = reduce({ annotations: [], cursor: null, pending: rows })
          .pending as StoredOperation[];
        return { annotations: [], cursor: null, pending: rows };
      },
    ),
  };
  const send = vi.fn(async () => ({ status: 200, body: {} }));
  const preflight = vi.fn(async () => ({ authenticated: true, deviceId: DEVICE }));
  const transport = createReaderTransport({
    store: store as unknown as OfflineStore,
    window: window as unknown as Window,
    locks: null,
    now: Date.now,
    token: () => "this-page",
    send,
    preflight,
    positionAcknowledged: () => true,
    decodeAnnotations: () => ({ outcomes: [] }),
  });
  /** The closing page's IndexedDB work and device check never finish */
  const closing = (persisted = false) => {
    store.inspect.mockImplementation(never);
    store.sealDeletes.mockImplementation(never);
    store.claim.mockImplementation(never);
    preflight.mockImplementation(never);
    window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted }));
  };
  return { transport, store, send, preflight, closing };
}
let transport: ReaderTransport | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  transport?.destroy();
  transport = null;
  vi.useRealTimers();
});

describe("a page closing inside a delete's Undo window (SLN-869)", () => {
  it("sends the delete at once, before any device check or IndexedDB work", async () => {
    const page = setup([deleting(1)]);
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    expect(page.send).not.toHaveBeenCalled();
    const checks = page.preflight.mock.calls.length;
    page.closing();
    // Synchronously, in the pagehide handler itself
    expect(page.send).toHaveBeenCalledTimes(1);
    const [plan, , mode] = page.send.mock.calls[0] as unknown as [
      { json: string },
      AbortSignal,
      string,
    ];
    expect(mode).toBe("lifecycle");
    expect(JSON.parse(plan.json).deletes.map((item: { id: string }) => item.id)).toEqual([
      itemId(1000),
    ]);
    expect(page.preflight).toHaveBeenCalledTimes(checks);
    // The row is still sealed, as any page that leaves seals it
    expect(page.store.sealDeletes).toHaveBeenLastCalledWith("lifecycle");
  });
  it("sends nothing once the delete was undone", async () => {
    const page = setup([deleting(1)]);
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    await transport.store.transactBook("book", () => ({
      annotations: [],
      cursor: null,
      pending: [],
    }));
    page.store.transactBook.mockClear();
    await vi.advanceTimersByTimeAsync(0);
    page.closing();
    expect(page.send).not.toHaveBeenCalled();
  });
  it("forgets the queue while an Undo is still being written", async () => {
    const page = setup([deleting(1)]);
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    page.store.transactBook.mockImplementation(never);
    void transport.store.transactBook("book", (current) => current);
    page.closing();
    expect(page.send).not.toHaveBeenCalled();
  });
  it("leaves a page kept for the back button to its own replay", async () => {
    const page = setup([deleting(1)]);
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    page.closing(true);
    expect(page.send).not.toHaveBeenCalled();
  });
  it("leaves a head another page has claimed to that page", async () => {
    const page = setup([
      deleting(1, {
        state: "claimed",
        claim: { token: "other-page", expiresAt: NOW + 30_000 },
      }),
    ]);
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    page.closing();
    expect(page.send).not.toHaveBeenCalled();
  });
  it("sends nothing past a blocked head", async () => {
    const page = setup([deleting(1, { state: "blocked" }), deleting(2)]);
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    page.closing();
    expect(page.send).not.toHaveBeenCalled();
  });
});

describe("pages turned inside a delete's Undo window, then the page closes (SLN-919)", () => {
  type Sent = [{ json: string; rows: StoredOperation[] }, AbortSignal, string];
  const sent = (send: ReturnType<typeof setup>["send"]) =>
    (send.mock.calls as unknown as Sent[]).map(([plan, , mode]) => ({
      mode,
      kind: plan.rows[0].mutation.kind,
      body: JSON.parse(plan.json),
    }));
  it("sends the newest place as a second keepalive, after the delete", async () => {
    const page = setup([deleting(1), turned(2, 0.2), turned(3, 0.3), turned(4, 0.4)]);
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    page.closing();
    const requests = sent(page.send);
    expect(requests.map(({ kind, mode }) => [kind, mode])).toEqual([
      ["annotations", "lifecycle"],
      ["position", "lifecycle"],
    ]);
    expect(requests[0].body.deletes.map((item: { id: string }) => item.id)).toEqual([itemId(1000)]);
    expect(requests[1].body.locator.totalProgression).toBe(0.4);
  });
  it("picks the newest place by time, not by queue order", async () => {
    const page = setup([
      deleting(1),
      turned(2, 0.6, { time: new Date(NOW + 50).toISOString() }),
      turned(3, 0.3),
    ]);
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    page.closing();
    expect(sent(page.send)[1].body.locator.totalProgression).toBe(0.6);
  });
  it("still sends the place alone when nothing waits before it", async () => {
    const page = setup([turned(1, 0.4)], { held: true });
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    page.closing();
    const requests = sent(page.send);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ kind: "position", mode: "lifecycle" });
  });
  it("sends the place, and not the mark, once the delete was undone", async () => {
    const page = setup([deleting(1), turned(2, 0.4)], { held: true });
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    await transport.store.transactBook("book", (current) => ({
      ...current,
      pending: current.pending.filter((row) => row.mutation.kind === "position"),
    }));
    await vi.advanceTimersByTimeAsync(0);
    page.closing();
    expect(sent(page.send).map(({ kind }) => kind)).toEqual(["position"]);
  });
  it("leaves the place to a later visit when the two bodies would not fit the keepalive budget", async () => {
    const page = setup([
      { ...annotations(1, { note: "x".repeat(61_200) }), v: 1, retryAt: null },
      turned(2, 0.4),
    ], { held: true });
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    page.closing();
    expect(sent(page.send).map(({ kind }) => kind)).toEqual(["annotations"]);
  });
  it("leaves out a place of another device, or one another page holds", async () => {
    const page = setup([
      deleting(1),
      turned(2, 0.4, { deviceId: OTHER }),
      { ...turned(3, 0.5), state: "claimed", claim: { token: "other-page", expiresAt: NOW + 30_000 } },
    ]);
    transport = page.transport;
    await vi.advanceTimersByTimeAsync(0);
    page.closing();
    expect(sent(page.send).map(({ kind }) => kind)).toEqual(["annotations"]);
  });
});
