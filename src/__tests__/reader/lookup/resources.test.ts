import { describe, expect, it, vi } from "vitest";
import {
  consumeLookupStream,
  LookupSemaphore,
} from "@/lib/reader/lookup/resources";

describe("lookup resource cancellation", () => {
  it("yields between byte windows so cancel timers interrupt a ready in-memory stream", async () => {
    const parent = new AbortController(),
      canceled = vi.fn(),
      consumed = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < 64; at++)
          controller.enqueue(new Uint8Array([at]));
      },
      cancel: canceled,
    });
    const timer = setTimeout(
      () => parent.abort(new DOMException("closed", "AbortError")),
      0,
    );
    try {
      await expect(
        consumeLookupStream(stream, 64, parent.signal, consumed),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(consumed.mock.calls.length).toBeLessThanOrEqual(16);
      expect(canceled).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(timer);
    }
  });
  it("bounds queued lifetimes as well as active work and releases exactly once", async () => {
    const slots = new LookupSemaphore(1),
      owner = await slots.acquire(new AbortController().signal);
    const parents = Array.from({ length: 65 }, () => new AbortController());
    const pending = parents.map((parent) => slots.acquire(parent.signal));
    const settled = Promise.allSettled(pending);
    parents.forEach((parent) =>
      parent.abort(new DOMException("closed", "AbortError")),
    );
    expect((await settled)[64]).toMatchObject({
      status: "rejected",
      reason: { message: "Too many lookup requests are waiting" },
    });
    owner();
    owner();
    const next = await slots.acquire(new AbortController().signal);
    next();
  });
});
