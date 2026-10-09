import {
  cropRegion,
  isNoCrop,
  type AppliedCrop,
  type CropRegion,
} from "./crop";

/** Wrap quarter-turn buttons as well as the slider's equivalent +180 endpoint. */
export function normalizeImageRotation(degrees: number): number {
  return (((degrees % 360) + 540) % 360) - 180;
}

export function isImageRotation(degrees: number): boolean {
  return (
    Number.isFinite(degrees) &&
    Number.isInteger(degrees) &&
    degrees >= -180 &&
    degrees <= 180
  );
}

export interface RotationGeometry {
  degrees: number;
  region: CropRegion;
  scale: number;
  /** Axis-aligned bounds after rotation, already scaled to fit the frame. */
  bounds: { width: number; height: number };
  /** The selected raster rectangle, centered before rotation. */
  selection: { left: number; top: number; width: number; height: number };
  /** The full source, translated inside the selected rectangle. */
  image: { left: number; top: number; width: number; height: number };
}

function validCrop(crop: AppliedCrop): boolean {
  return (
    Number.isFinite(crop.x) &&
    crop.x >= 0 &&
    crop.x <= 100 &&
    Number.isFinite(crop.y) &&
    crop.y >= 0 &&
    crop.y <= 100 &&
    Number.isFinite(crop.zoom) &&
    crop.zoom >= 100 &&
    crop.zoom <= 300
  );
}

/**
 * Fit the entire available raster (or a pending explicit crop) without losing
 * any selected pixels. Saved derivatives already contain their crop: leave
 * pendingCrop absent when rendering the actual display source. This helper
 * does not infer a crop from the caller's former object-fit rectangle.
 */
export function imageRotationGeometry({
  sourceWidth,
  sourceHeight,
  frameWidth,
  frameHeight,
  rotation,
  pendingCrop = null,
  cropAspect = null,
}: {
  sourceWidth: number;
  sourceHeight: number;
  frameWidth: number;
  frameHeight: number;
  rotation: number;
  pendingCrop?: AppliedCrop | null;
  cropAspect?: number | null;
}): RotationGeometry | null {
  if (
    !Number.isSafeInteger(sourceWidth) ||
    sourceWidth <= 0 ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceHeight <= 0 ||
    !Number.isFinite(frameWidth) ||
    frameWidth <= 0 ||
    !Number.isFinite(frameHeight) ||
    frameHeight <= 0 ||
    !isImageRotation(rotation) ||
    (pendingCrop && !validCrop(pendingCrop))
  )
    return null;
  let region: CropRegion = {
    left: 0,
    top: 0,
    width: sourceWidth,
    height: sourceHeight,
  };
  if (pendingCrop && !isNoCrop(pendingCrop)) {
    if (cropAspect === null || !Number.isFinite(cropAspect) || cropAspect <= 0)
      return null;
    region = cropRegion(sourceWidth, sourceHeight, cropAspect, pendingCrop);
  }
  const degrees = normalizeImageRotation(rotation);
  // Exact quarter turns avoid residual cosine causing an unnecessary shrink.
  const quarterTurn = degrees % 90 === 0;
  const radians = (degrees * Math.PI) / 180;
  const cosine = quarterTurn
    ? degrees % 180 === 0
      ? 1
      : 0
    : Math.abs(Math.cos(radians));
  const sine = quarterTurn
    ? degrees % 180 === 0
      ? 0
      : 1
    : Math.abs(Math.sin(radians));
  const width = region.width * cosine + region.height * sine;
  const height = region.width * sine + region.height * cosine;
  const scale = Math.min(frameWidth / width, frameHeight / height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const selectedWidth = region.width * scale;
  const selectedHeight = region.height * scale;
  return {
    degrees,
    region,
    scale,
    bounds: { width: width * scale, height: height * scale },
    selection: {
      left: (frameWidth - selectedWidth) / 2,
      top: (frameHeight - selectedHeight) / 2,
      width: selectedWidth,
      height: selectedHeight,
    },
    image: {
      left: -region.left * scale,
      top: -region.top * scale,
      width: sourceWidth * scale,
      height: sourceHeight * scale,
    },
  };
}

/** Unchanged edits use the actual derivative; dirty crop/reset uses retained base. */
export function rotationPreviewSource(
  sources: { display: string; preview: string },
  cropChanged: boolean,
): string {
  return cropChanged ? sources.preview : sources.display;
}
