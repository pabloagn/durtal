import { describe, expect, it } from "vitest";
import { NO_CROP } from "@/lib/media/crop";
import {
  imageRotationGeometry,
  normalizeImageRotation,
  rotationPreviewSource,
} from "@/lib/media/rotation";

const landscape = {
  sourceWidth: 1200,
  sourceHeight: 600,
  frameWidth: 200,
  frameHeight: 300,
};

describe("display-only rotation geometry", () => {
  it("wraps quarter-turn buttons in both directions without a second angle field", () => {
    expect(normalizeImageRotation(180)).toBe(-180);
    expect(normalizeImageRotation(-270)).toBe(90);
    expect(normalizeImageRotation(270)).toBe(-90);
    expect(normalizeImageRotation(normalizeImageRotation(170 + 90) - 90)).toBe(
      170,
    );
  });
  it("fits a whole landscape raster in a portrait slot, never inferring its former cover crop", () => {
    const result = imageRotationGeometry({ ...landscape, rotation: 90 })!;
    expect(result.region).toEqual({
      left: 0,
      top: 0,
      width: 1200,
      height: 600,
    });
    expect(result.scale).toBe(0.25);
    expect(result.bounds).toEqual({ width: 150, height: 300 });
    expect(result.selection).toEqual({
      left: -50,
      top: 75,
      width: 300,
      height: 150,
    });
    expect(result.image).toEqual({
      left: -0,
      top: -0,
      width: 300,
      height: 150,
    });
  });
  it("contains a 45 degree raster with intentional margins and uniform scale", () => {
    const result = imageRotationGeometry({ ...landscape, rotation: 45 })!;
    expect(result.bounds.width).toBeCloseTo(200, 10);
    expect(result.bounds.height).toBeCloseTo(200, 10);
    expect(result.image.width / result.image.height).toBe(2);
    expect(result.selection.left + result.selection.width / 2).toBe(100);
    expect(result.selection.top + result.selection.height / 2).toBe(150);
  });
  it("treats a neutral pending reset as the whole retained base despite the portrait crop aspect", () => {
    expect(
      imageRotationGeometry({
        ...landscape,
        rotation: 45,
        pendingCrop: NO_CROP,
        cropAspect: 2 / 3,
      })!.region,
    ).toEqual({ left: 0, top: 0, width: 1200, height: 600 });
  });
  it("selects an explicit crop in unrotated coordinates with the server's integer pixel rounding", () => {
    const result = imageRotationGeometry({
      ...landscape,
      rotation: -90,
      pendingCrop: { x: 30, y: 70, zoom: 140 },
      cropAspect: 2 / 3,
    })!;
    // 400x600 cover region; zoom shrinks it around the original focal point.
    expect(result.region).toEqual({
      left: 274,
      top: 120,
      width: 286,
      height: 429,
    });
    expect(result.image.left).toBeCloseTo(-274 * result.scale);
    expect(result.image.top).toBeCloseTo(-120 * result.scale);
    expect(result.image.width / result.image.height).toBe(2);
    expect(result.bounds.width).toBeCloseTo(200);
  });
  it("rotates an already cropped derivative once, using its actual available dimensions", () => {
    const result = imageRotationGeometry({
      ...landscape,
      sourceWidth: 286,
      sourceHeight: 429,
      rotation: 90,
    })!;
    expect(result.region).toEqual({ left: 0, top: 0, width: 286, height: 429 });
    expect(result.bounds.width).toBe(200);
    expect(result.bounds.height).toBeCloseTo((200 * 286) / 429);
  });
  it("contains all four selected corners for every slider angle, aspect and small frame", () => {
    for (const [sourceWidth, sourceHeight] of [
      [1200, 600],
      [600, 1200],
      [1, 1],
      [3, 1000],
    ]) {
      for (const [frameWidth, frameHeight] of [
        [200, 300],
        [640, 100],
        [0.5, 0.75],
      ]) {
        for (let rotation = -180; rotation <= 180; rotation++) {
          const g = imageRotationGeometry({
            sourceWidth,
            sourceHeight,
            frameWidth,
            frameHeight,
            rotation,
          })!;
          const angle = (rotation * Math.PI) / 180;
          for (const x of [-g.selection.width / 2, g.selection.width / 2]) {
            for (const y of [-g.selection.height / 2, g.selection.height / 2]) {
              const rx =
                frameWidth / 2 + x * Math.cos(angle) - y * Math.sin(angle);
              const ry =
                frameHeight / 2 + x * Math.sin(angle) + y * Math.cos(angle);
              expect(rx).toBeGreaterThanOrEqual(-1e-10);
              expect(rx).toBeLessThanOrEqual(frameWidth + 1e-10);
              expect(ry).toBeGreaterThanOrEqual(-1e-10);
              expect(ry).toBeLessThanOrEqual(frameHeight + 1e-10);
            }
          }
        }
      }
    }
  });
  it.each([
    { sourceWidth: 0 },
    { sourceHeight: 0 },
    { sourceWidth: 12.5 },
    { sourceWidth: Infinity },
    { frameWidth: 0 },
    { frameHeight: NaN },
    { rotation: 181 },
    { rotation: 1.5 },
    { pendingCrop: { x: -1, y: 50, zoom: 100 } },
    { pendingCrop: { x: 50, y: NaN, zoom: 100 } },
    { pendingCrop: { x: 50, y: 50, zoom: 301 } },
    { pendingCrop: { x: 0, y: 50, zoom: 100 } },
    { pendingCrop: { x: 0, y: 50, zoom: 100 }, cropAspect: Infinity },
  ])("refuses unavailable or invalid geometry %j", (invalid) => {
    expect(
      imageRotationGeometry({ ...landscape, rotation: 45, ...invalid }),
    ).toBeNull();
  });
  it("chooses stored pixels for unchanged edits/Compare and the retained base for dirty crop or reset", () => {
    const sources = { display: "derivative", preview: "retained-base" };
    expect(rotationPreviewSource(sources, false)).toBe("derivative");
    expect(rotationPreviewSource(sources, true)).toBe("retained-base");
    expect(
      rotationPreviewSource({ display: "legacy", preview: "legacy" }, true),
    ).toBe("legacy");
  });
});
