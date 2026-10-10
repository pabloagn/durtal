import { describe, expect, it } from "vitest";
import {
  fixedCanvasLimits,
  MAX_CANVAS_BYTES,
  MAX_PAGE_PIXELS,
  rasterPlan,
  renderDpr,
} from "@/lib/reader/engines/foliate/canvas-budget";

const input = {
  pageCssWidth: 600,
  pageCssHeight: 800,
  devicePixelRatio: 3,
  otherCanvasBytes: 0,
};

describe("fixed-page canvas policy", () => {
  it("caps DPR on desktop as well as phones, retaining the nominal floor", () => {
    expect(renderDpr(input)).toBe(2);
    expect(renderDpr({ ...input, devicePixelRatio: 0.75 })).toBe(1);
    expect(
      renderDpr({ ...input, pageCssWidth: 10000, pageCssHeight: 14000 }),
    ).toBe(1);
  });

  it("caps a 400% page on a 2560px screen without changing CSS geometry", () => {
    const css = { ...input, pageCssWidth: 2560 * 4, pageCssHeight: 3300 * 4 };
    const plan = rasterPlan(css)!;
    expect(plan.dpr).toBe(1);
    expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_PAGE_PIXELS);
    expect(plan.scaleX).toBeLessThan(1);
    expect(plan.width / plan.scaleX).toBe(css.pageCssWidth);
    expect(plan.height / plan.scaleY).toBe(css.pageCssHeight);
  });

  it.each([3, 4])(
    "budgets %i allocations including pending renders",
    (count) => {
      let reserved = 0;
      for (let i = 0; i < count; i++) {
        const plan = rasterPlan({
          ...input,
          pageCssWidth: i === 0 ? 10000 : 1800,
          pageCssHeight: i === 0 ? 14000 : 2400,
          otherCanvasBytes: reserved,
        })!;
        expect(plan).not.toBeNull();
        expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_PAGE_PIXELS);
        reserved += plan.bytes;
        expect(reserved).toBeLessThanOrEqual(MAX_CANVAS_BYTES);
      }
    },
  );

  it("defers allocation when even one pixel would exceed the shared limit", () => {
    expect(
      rasterPlan({ ...input, otherCanvasBytes: MAX_CANVAS_BYTES }),
    ).toBeNull();
    expect(
      rasterPlan({ ...input, otherCanvasBytes: MAX_CANVAS_BYTES + 4 }),
    ).toBeNull();
    expect(
      rasterPlan({ ...input, otherCanvasBytes: MAX_CANVAS_BYTES - 4 }),
    ).toMatchObject({ width: 1, height: 1, bytes: 4 });
  });

  it("never overshoots with fractional CSS sizes or integer backing dimensions", () => {
    for (const width of [0.4, 390.5, 999.9, 2560.3, 10000.7]) {
      for (const otherCanvasBytes of [0, 80000000, MAX_CANVAS_BYTES - 1000]) {
        const plan = rasterPlan({
          ...input,
          pageCssWidth: width,
          pageCssHeight: 1200.7,
          otherCanvasBytes,
        });
        if (!plan) continue;
        expect(Number.isInteger(plan.width)).toBe(true);
        expect(Number.isInteger(plan.height)).toBe(true);
        expect(plan.bytes + otherCanvasBytes).toBeLessThanOrEqual(
          MAX_CANVAS_BYTES,
        );
        expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_PAGE_PIXELS);
      }
    }
  });

  it("uses the explicit page and spread limits", () => {
    expect(fixedCanvasLimits(false)).toEqual({
      pageCanvases: 3,
      cachedSpreads: 2,
    });
    expect(fixedCanvasLimits(true)).toEqual({
      pageCanvases: 4,
      cachedSpreads: 1,
    });
  });

  it.each([
    { pageCssWidth: 0 },
    { pageCssHeight: NaN },
    { devicePixelRatio: Infinity },
    { otherCanvasBytes: -1 },
    { otherCanvasBytes: 0.5 },
  ])("rejects invalid allocation inputs %o", (invalid) =>
    expect(() => rasterPlan({ ...input, ...invalid })).toThrow(RangeError),
  );
});
