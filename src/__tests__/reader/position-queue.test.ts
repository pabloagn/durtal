import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPositionQueue, SAVE_INTERVAL_MS, type PositionSave } from "@/lib/reader/position-queue";

/* SLN-492: the place is saved off the input path, at most once every 2 seconds, and flushed on leaving */

const save = (n: number): PositionSave => ({
  fileId: "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11",
  locator: { v: 1, fileHash: "a".repeat(64), href: "c.xhtml", sectionIndex: 0, progression: n / 10, totalProgression: n / 100 },
  chapter: `Chapter ${n}`,
  clientUpdatedAt: new Date(1_800_000_000_000 + n).toISOString(),
});

const sentBody = (fetch: ReturnType<typeof vi.fn>, call: number) => JSON.parse((fetch.mock.calls[call][1] as RequestInit).body as string);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createPositionQueue", () => {
  it("sends ten turns in one second as one request, with the newest place", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    const queue = createPositionQueue({ url: "/api/reader/e/position", fetch, window: null });
    for (let n = 1; n <= 10; n++) {
      queue.push(save(n));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS - 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sentBody(fetch, 0).chapter).toBe("Chapter 10");
    expect((fetch.mock.calls[0] as unknown[])[1]).toMatchObject({ method: "POST", keepalive: true });
    expect(queue.pending).toBe(false);

    queue.push(save(4));
    await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a place whose send failed for the next flush", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(new Response(null, { status: 503 }));
    const queue = createPositionQueue({ url: "/p", fetch, window: null });
    queue.push(save(1));
    await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);
    expect(queue.pending).toBe(true);
    queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    // A server error is kept too
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(queue.pending).toBe(true);
  });

  it("drops a place the server refuses", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 400 }));
    const queue = createPositionQueue({ url: "/p", fetch, window: null });
    queue.push(save(1));
    await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);
    expect(queue.pending).toBe(false);
  });

  it("does not put an older failed place over a newer one", async () => {
    let fail: (reason: unknown) => void = () => {};
    const fetch = vi.fn(() => new Promise<Response>((_, reject) => (fail = reject)));
    const queue = createPositionQueue({ url: "/p", fetch, window: null });
    queue.push(save(1));
    await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);
    queue.push(save(2));
    fail(new TypeError("offline"));
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockImplementation(async () => new Response(null, { status: 200 }));
    queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentBody(fetch, 1).chapter).toBe("Chapter 2");
  });

  it("goes out by beacon when the page is hidden or goes away", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    const beacons: Blob[] = [];
    const win = new EventTarget() as EventTarget & { document: EventTarget & { visibilityState: string } };
    win.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const queue = createPositionQueue({
      url: "/p",
      fetch,
      sendBeacon: (_url, data) => (beacons.push(data), true),
      window: win as unknown as Window,
    });
    queue.push(save(1));
    win.document.visibilityState = "hidden";
    win.document.dispatchEvent(new Event("visibilitychange"));
    expect(beacons).toHaveLength(1);
    expect(JSON.parse(await beacons[0].text()).chapter).toBe("Chapter 1");
    expect(queue.pending).toBe(false);

    queue.push(save(2));
    win.dispatchEvent(new Event("pagehide"));
    expect(beacons).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(SAVE_INTERVAL_MS);
    expect(fetch).not.toHaveBeenCalled();

    queue.destroy();
    queue.push(save(3));
    win.dispatchEvent(new Event("pagehide"));
    expect(beacons).toHaveLength(2);
  });

  it("falls back to fetch when the beacon is refused", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    const queue = createPositionQueue({ url: "/p", fetch, sendBeacon: () => false, window: null });
    queue.push(save(1));
    queue.flush({ beacon: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
