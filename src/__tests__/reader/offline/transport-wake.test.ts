import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReaderTransport,
  type ReaderTransport,
} from "@/lib/reader/offline/transport";
import {
  matchesClaim,
  planReplayClaim,
  releaseClaim,
} from "@/lib/reader/offline/outbox-policy";
import type { OfflineStore, StoredOperation } from "@/lib/reader/offline/store";
import { DEVICE, NOW, position } from "./fixtures";

function setup(
  options: { blocked?: boolean; claimAfterInspect?: boolean } = {},
) {
  let rows: StoredOperation[] = [
    {
      ...position(1, 0.5),
      v: 1,
      retryAt: null,
      state: options.blocked
        ? "blocked"
        : options.claimAfterInspect
          ? "waiting"
          : "claimed",
      claim:
        options.blocked || options.claimAfterInspect
          ? null
          : { token: "abandoned", expiresAt: NOW + 30_000 },
    },
  ];
  const document = Object.assign(new EventTarget(), {
    visibilityState: "hidden",
  });
  const window = Object.assign(new EventTarget(), {
    document,
    navigator: { onLine: true },
  });
  const inspect = vi.fn(async () => rows);
  const store = {
    inspect,
    claim: vi.fn(
      async (claimOptions: Parameters<typeof planReplayClaim>[1]) => {
        if (options.claimAfterInspect) {
          options.claimAfterInspect = false;
          rows = rows.map((row) => ({
            ...row,
            state: "claimed",
            claim: { token: "peer", expiresAt: NOW + 30_000 },
          }));
        }
        const plan = planReplayClaim(rows, claimOptions);
        if (plan.kind === "claim")
          rows = plan.rows.map((row) => ({ ...row, v: 1, retryAt: null }));
        return plan;
      },
    ),
    settle: vi.fn(
      async (
        references: Parameters<OfflineStore["settle"]>[0],
        outcome: Parameters<OfflineStore["settle"]>[1],
      ) => {
        for (const reference of references)
          rows = rows.flatMap((row) =>
            !matchesClaim(row, reference)
              ? [row]
              : outcome === "acknowledged"
                ? []
                : [
                    {
                      ...releaseClaim(row, reference, outcome === "blocked"),
                      v: 1,
                      retryAt: null,
                    },
                  ],
          );
        return references.length;
      },
    ),
  };
  const send = vi.fn(async () => ({ status: 200, body: { saved: true } }));
  const preflight = vi.fn(async () => ({
    authenticated: true,
    deviceId: DEVICE,
  }));
  const transport = createReaderTransport({
    store: store as unknown as OfflineStore,
    window: window as unknown as Window,
    locks: null,
    now: Date.now,
    token: () => "new-owner",
    send,
    preflight,
    positionAcknowledged: () => true,
    decodeAnnotations: () => ({ outcomes: [] }),
  });
  const visibility = (value: "hidden" | "visible") => {
    document.visibilityState = value;
    document.dispatchEvent(new Event("visibilitychange"));
  };
  return { transport, store, send, preflight, visibility, rows: () => rows };
}
let transport: ReaderTransport | null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  transport?.destroy();
  transport = null;
  vi.useRealTimers();
});

describe("persisted claim expiry wake", () => {
  it("a newly visible tab replays an abandoned claim after 31 seconds without another event", async () => {
    const test = setup();
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.send).not.toHaveBeenCalled();
    expect(test.preflight).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(test.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(test.send).toHaveBeenCalledTimes(1);
    const plan = test.send.mock.calls[0] as unknown[];
    expect(
      (plan[0] as { references: { token: string }[] }).references[0].token,
    ).toBe("new-owner");
    expect(test.rows()).toEqual([]);
  });
  it("cancels the wake while hidden and resumes the expired head when visible", async () => {
    const test = setup();
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    test.visibility("hidden");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(test.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.send).toHaveBeenCalledTimes(1);
  });
  it("does not wake an explicitly blocked head after any lease time", async () => {
    const test = setup({ blocked: true });
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(test.send).not.toHaveBeenCalled();
    expect(test.preflight).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(test.rows()[0].state).toBe("blocked");
  });
  it("destroy cancels the scheduled lease wake", async () => {
    const test = setup();
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    transport.destroy();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(test.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses a peer's persisted expiry if ownership changed after inspection", async () => {
    const test = setup({ claimAfterInspect: true });
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(test.send).toHaveBeenCalledTimes(1);
  });
});
