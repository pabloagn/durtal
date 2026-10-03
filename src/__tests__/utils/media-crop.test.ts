import { describe, it, expect } from "vitest";
import {
  cropRegion,
  isNoCrop,
  mediaFrameAspect,
  NO_CROP,
  sameCrop,
} from "@/lib/media/crop";

const POSTER = 2 / 3;

describe("cropRegion", () => {
  it("keeps the full image when the frame has its aspect and there is no crop", () => {
    expect(cropRegion(1000, 1500, POSTER, NO_CROP)).toEqual({ left: 0, top: 0, width: 1000, height: 1500 });
  });

  it("takes the centered cover box of a wider image", () => {
    // 1500 high at 2:3 is 1000 wide, centered in 2000
    expect(cropRegion(2000, 1500, POSTER, NO_CROP)).toEqual({ left: 500, top: 0, width: 1000, height: 1500 });
  });

  it("moves the cover box with the focal point", () => {
    expect(cropRegion(2000, 1500, POSTER, { x: 0, y: 50, zoom: 100 }).left).toBe(0);
    expect(cropRegion(2000, 1500, POSTER, { x: 100, y: 50, zoom: 100 }).left).toBe(1000);
    // A taller image moves vertically
    expect(cropRegion(1000, 2000, POSTER, { x: 50, y: 0, zoom: 100 })).toEqual({ left: 0, top: 0, width: 1000, height: 1500 });
    expect(cropRegion(1000, 2000, POSTER, { x: 50, y: 100, zoom: 100 }).top).toBe(500);
  });

  it("zooms around the focal point like transform-origin does", () => {
    expect(cropRegion(1000, 1500, POSTER, { x: 50, y: 50, zoom: 200 })).toEqual({ left: 250, top: 375, width: 500, height: 750 });
    expect(cropRegion(1000, 1500, POSTER, { x: 0, y: 0, zoom: 200 })).toEqual({ left: 0, top: 0, width: 500, height: 750 });
    expect(cropRegion(1000, 1500, POSTER, { x: 100, y: 100, zoom: 200 })).toEqual({ left: 500, top: 750, width: 500, height: 750 });
  });

  it("matches the CSS framing at any point: frame point p shows image point", () => {
    // Browser model: cover scale s, offset o = (frame - image * s) * f,
    // then scale(z) around origin O = frame * f. The frame's left edge (0)
    // maps back to element point O - O / z, then to image (that - o) / s.
    const [w, h, frameW, frameH] = [1200, 1600, 200, 300];
    const crop = { x: 30, y: 70, zoom: 140 };
    const s = Math.max(frameW / w, frameH / h);
    const z = crop.zoom / 100;
    const ox = frameW * (crop.x / 100);
    const oy = frameH * (crop.y / 100);
    const offX = (frameW - w * s) * (crop.x / 100);
    const offY = (frameH - h * s) * (crop.y / 100);
    const left = (ox - ox / z - offX) / s;
    const top = (oy - oy / z - offY) / s;
    expect(cropRegion(w, h, frameW / frameH, crop)).toEqual({
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(frameW / z / s),
      height: Math.round(frameH / z / s),
    });
  });

  it("always stays inside the image", () => {
    for (const [w, h] of [[1, 1], [3, 1000], [1000, 3], [1600, 2400], [2560, 1440]])
      for (const aspect of [POSTER, 16 / 9])
        for (const x of [0, 33, 100])
          for (const zoom of [100, 187, 300]) {
            const r = cropRegion(w, h, aspect, { x, y: 100 - x, zoom });
            expect(r.left).toBeGreaterThanOrEqual(0);
            expect(r.top).toBeGreaterThanOrEqual(0);
            expect(r.width).toBeGreaterThanOrEqual(1);
            expect(r.height).toBeGreaterThanOrEqual(1);
            expect(r.left + r.width).toBeLessThanOrEqual(w);
            expect(r.top + r.height).toBeLessThanOrEqual(h);
          }
  });
});

describe("crop helpers", () => {
  it("knows the frame of each croppable type", () => {
    expect(mediaFrameAspect("poster")).toBe(2 / 3);
    expect(mediaFrameAspect("background")).toBe(16 / 9);
    expect(mediaFrameAspect("gallery")).toBeNull();
  });

  it("compares crops", () => {
    expect(isNoCrop(NO_CROP)).toBe(true);
    expect(isNoCrop({ x: 50, y: 50, zoom: 101 })).toBe(false);
    expect(sameCrop(null, null)).toBe(true);
    expect(sameCrop(NO_CROP, null)).toBe(false);
    expect(sameCrop({ x: 1, y: 2, zoom: 3 }, { x: 1, y: 2, zoom: 3 })).toBe(true);
  });
});
