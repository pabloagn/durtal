import { describe, expect, it, vi } from "vitest";
import { CanvasLedger } from "@/lib/reader/engines/foliate/canvas-ledger";
import { MAX_CANVAS_BYTES } from "@/lib/reader/engines/foliate/canvas-budget";

const normal = { pageCssWidth: 600, pageCssHeight: 800, devicePixelRatio: 2 };
const huge = { pageCssWidth: 10000, pageCssHeight: 10000, devicePixelRatio: 4 };

describe("owned canvas allocation ledger", () => {
  it("counts every pending reservation before any backing is created", () => {
    const ledger = new CanvasLedger();
    const first = ledger.reserve(huge)!;
    const second = ledger.reserve(huge)!;
    expect(ledger.bytes).toBeLessThanOrEqual(MAX_CANVAS_BYTES);
    expect(ledger.count).toBe(2);
    expect(ledger.reserve(huge)).toBeNull();
    expect(Object.isFrozen(first.plan)).toBe(true);
    first.release();
    expect(ledger.reserve(huge)).not.toBeNull();
    second.release();
    ledger.close();
    expect(ledger.bytes).toBe(0);
  });

  it("limits all live plus pending page canvases for either spread mode", () => {
    const ledger = new CanvasLedger();
    const leases = Array.from({ length: 3 }, () => ledger.reserve(normal)!);
    expect(ledger.reserve(normal)).toBeNull();
    ledger.setTwoPages(true);
    const fourth = ledger.reserve(normal)!;
    expect(ledger.reserve(normal)).toBeNull();
    expect(() => ledger.setTwoPages(false)).toThrow(/Evict/);
    fourth.release();
    ledger.setTwoPages(false);
    expect(ledger.bytes).toBe(
      leases.reduce((sum, lease) => sum + lease.plan.bytes, 0),
    );
    ledger.close();
    expect(leases.every((lease) => !lease.active)).toBe(true);
    expect(() => ledger.reserve(normal)).toThrow(/closed/);
  });

  it("cancels only its owned paint before clearing the canvas, once", () => {
    const ledger = new CanvasLedger();
    const first = ledger.reserve(normal)!;
    const second = ledger.reserve(normal)!;
    const canvas = first.allocate(() => ({ width: 300, height: 150 }));
    expect([canvas.width, canvas.height]).toEqual([1200, 1600]);
    const cancel = vi.fn(() => expect(canvas.width).toBe(1200));
    first.ownPaint({ cancel });
    first.release();
    first.release();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(second.active).toBe(true);
    expect(ledger.bytes).toBe(second.plan.bytes);
    expect(() => first.allocate(() => canvas)).toThrow(/unavailable/);
    const late = { cancel: vi.fn() };
    expect(() => first.ownPaint(late)).toThrow(/unavailable/);
    expect(late.cancel).toHaveBeenCalledOnce();
    ledger.close();
  });

  it("releases failed allocation and refuses repeated or reentrant allocation", () => {
    const ledger = new CanvasLedger();
    const lease = ledger.reserve(normal)!;
    expect(() =>
      lease.allocate(() => {
        throw new Error("allocation");
      }),
    ).toThrow("allocation");
    expect(ledger.count).toBe(0);
    const live = ledger.reserve(normal)!;
    live.allocate(() => ({ width: 0, height: 0 }));
    expect(() => live.allocate(() => ({ width: 0, height: 0 }))).toThrow(
      /unavailable/,
    );
    const reentrant = ledger.reserve(normal)!;
    const backing = { width: 300, height: 150 };
    expect(() =>
      reentrant.allocate(() => {
        reentrant.release();
        return backing;
      }),
    ).toThrow(/released during/);
    expect(backing).toEqual({ width: 0, height: 0 });
    ledger.close();
  });

  it("releases all owners even when an individual cancellation throws", () => {
    const ledger = new CanvasLedger();
    const lease = ledger.reserve(normal)!;
    const other = ledger.reserve(normal)!;
    const canvas = lease.allocate(() => ({ width: 0, height: 0 }));
    lease.ownPaint({
      cancel: () => {
        throw new Error("cancel");
      },
    });
    expect(() => ledger.close()).toThrow(/cleanup failed/);
    expect([canvas.width, canvas.height, ledger.count, ledger.bytes]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(other.active).toBe(false);
  });
});
