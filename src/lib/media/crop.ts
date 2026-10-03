/**
 * Crop geometry for poster and background media. Pure module, usable on
 * server and client.
 *
 * The editor frames an image like CSS does: `object-fit: cover` in a frame of
 * the media type's aspect, `object-position: x% y%`, then
 * `transform: scale(zoom / 100)` around the same point. `cropRegion()` turns
 * that framing into the pixel rectangle the frame shows, so the saved file
 * holds exactly what the editor preview showed.
 */

/** The crop saved into a media file, in the editor's terms. */
export interface AppliedCrop {
  /** Horizontal focal point, 0-100 % */
  x: number;
  /** Vertical focal point, 0-100 % */
  y: number;
  /** Zoom, 100-300 % */
  zoom: number;
}

export const NO_CROP: AppliedCrop = { x: 50, y: 50, zoom: 100 };

/** Frame aspect (width / height) of a media type that can be cropped. */
export function mediaFrameAspect(type: string): number | null {
  if (type === "poster") return 2 / 3;
  if (type === "background") return 16 / 9;
  return null;
}

/**
 * True when the crop shows the full frame at the center. For the frame of
 * the image's own aspect it removes nothing.
 */
export function isNoCrop(crop: AppliedCrop): boolean {
  return crop.x === NO_CROP.x && crop.y === NO_CROP.y && crop.zoom === NO_CROP.zoom;
}

export function sameCrop(a: AppliedCrop | null, b: AppliedCrop | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The integer pixel rectangle of a `width` x `height` image that a frame of
 * `aspect` shows with this crop. Always inside the image, at least 1px.
 */
export function cropRegion(
  width: number,
  height: number,
  aspect: number,
  crop: AppliedCrop,
): CropRegion {
  // object-fit: cover shows the largest centered box of the frame's aspect
  const coverWidth = width / height > aspect ? height * aspect : width;
  const coverHeight = coverWidth / aspect;
  const fx = crop.x / 100;
  const fy = crop.y / 100;
  const zoom = crop.zoom / 100;
  // object-position moves that box; scale() around the same point shrinks it
  const left = (width - coverWidth) * fx + coverWidth * fx * (1 - 1 / zoom);
  const top = (height - coverHeight) * fy + coverHeight * fy * (1 - 1 / zoom);
  const w = coverWidth / zoom;
  const h = coverHeight / zoom;

  const x0 = clamp(Math.round(left), 0, width - 1);
  const y0 = clamp(Math.round(top), 0, height - 1);
  return {
    left: x0,
    top: y0,
    width: clamp(Math.round(w), 1, width - x0),
    height: clamp(Math.round(h), 1, height - y0),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
