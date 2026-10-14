import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReaderTransport,
  type ReaderTransport,
} from "@/lib/reader/offline/transport";
import {
  adoptDevice,
  matchesClaim,
  planReplayClaim,
  reconcileBlocked,
  releaseClaim,
} from "@/lib/reader/offline/outbox-policy";
import type { OfflineStore, StoredOperation } from "@/lib/reader/offline/store";
import { DEVICE, NOW, OTHER, position } from "./fixtures";

function setup(
  options: {
    blocked?: boolean;
    claimAfterInspect?: boolean;
    waiting?: boolean;
    current?: string;
    retryAt?: number;
  } = {},
) {
  let rows: StoredOperation[] = [
    {
      ...position(1, 0.5),
      v: 1,
      retryAt: options.retryAt ?? null,
      state: options.blocked
        ? "blocked"
        : options.claimAfterInspect || options.waiting
          ? "waiting"
          : "claimed",
      claim:
        options.blocked || options.claimAfterInspect || options.waiting
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
    sealDeletes: vi.fn(async () => 0),
    inspect,
    retryNow: vi.fn(async () => {
      const head = rows[0];
      if (!head || head.state !== "waiting" || head.retryAt === null)
        return false;
      rows = [{ ...head, retryAt: null }, ...rows.slice(1)];
      return true;
    }),
    reconcile: vi.fn(
      async (
        reference: Parameters<OfflineStore["reconcile"]>[0],
        current: string | null,
      ) => {
        const before = rows[0];
        rows = rows.map((row) => ({ ...row, ...reconcileBlocked(row, reference, current) }));
        return rows[0].state !== before.state;
      },
    ),
    adoptDevice: vi.fn(async (superseded: string, current: string) => {
      const before = rows;
      rows = rows.map((row) => ({
        ...row,
        ...adoptDevice(row, superseded, current),
      }));
      return rows.filter((row, i) => row.mutation !== before[i].mutation)
        .length;
    }),
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
    deviceId: options.current ?? DEVICE,
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
    test.visibility("hidden");
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(test.send).not.toHaveBeenCalled();
    // One probe per page, to learn whether its device id was superseded
    expect(test.preflight).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(test.rows()[0].state).toBe("blocked");
  });
});

describe("a superseded device id (SLN-668)", () => {
  it("moves a waiting head to the cookie's device and sends it", async () => {
    const test = setup({ waiting: true, current: OTHER });
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.store.adoptDevice).toHaveBeenCalledWith(DEVICE, OTHER);
    expect(test.send).toHaveBeenCalledTimes(1);
    const plan = test.send.mock.calls[0] as unknown[];
    expect(
      (plan[0] as { rows: { mutation: { deviceId: string } }[] }).rows[0]
        .mutation.deviceId,
    ).toBe(OTHER);
    expect(test.rows()).toEqual([]);
  });
  it("frees a head blocked under the superseded id", async () => {
    const test = setup({ blocked: true, current: OTHER });
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(test.rows()).toEqual([]);
  });
  it("never adopts for a signed-out page", async () => {
    const test = setup({ waiting: true, current: OTHER });
    test.preflight.mockResolvedValue({ authenticated: false, deviceId: OTHER });
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.store.adoptDevice).not.toHaveBeenCalled();
    expect(test.send).not.toHaveBeenCalled();
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

describe("Retry while sync is paused (SLN-668)", () => {
  it("sends a head waiting out its backoff now", async () => {
    const test = setup({ waiting: true, retryAt: NOW + 300_000 });
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.send).not.toHaveBeenCalled();
    await transport.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.store.retryNow).toHaveBeenCalledTimes(1);
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(test.rows()).toEqual([]);
  });
  it("probes a blocked head again on Retry, and keeps it while still signed out", async () => {
    const test = setup({ blocked: true });
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.preflight).toHaveBeenCalledTimes(1);
    test.preflight.mockResolvedValue({ authenticated: false, deviceId: null } as never);
    await transport.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.preflight).toHaveBeenCalledTimes(3);
    expect(test.send).not.toHaveBeenCalled();
    expect(test.rows()[0].state).toBe("blocked");
  });
  it("sends a blocked head on Retry once signed in again under this device", async () => {
    const test = setup({ blocked: true });
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.send).not.toHaveBeenCalled();
    await transport.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.store.reconcile).toHaveBeenCalledTimes(1);
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(test.rows()).toEqual([]);
  });
  it("frees a blocked head on Retry once the cookie's device has changed", async () => {
    const test = setup({ blocked: true });
    transport = test.transport;
    test.visibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    test.preflight.mockResolvedValue({ authenticated: true, deviceId: OTHER });
    await transport.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(test.rows()).toEqual([]);
  });
});
