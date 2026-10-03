/**
 * Display settings of a media image (poster or background) and the inline
 * style that applies them. Pure module, usable on server and client.
 *
 * Everything here is CSS at render time.
 * - crop: framing (object-position, and transform: scale for a legacy zoom).
 *   A crop saved in the editor is written into the image files
 *   (`src/lib/media/display.ts`) and keeps only its focal point here: it
 *   moves the image inside its own file, so no view shows what was cut.
 * - brightness / contrast: CSS filter, in percent (100 = unchanged)
 */
import type { CSSProperties } from "react";

export interface MediaCrop {
  /** Horizontal focal point, 0-100 % */
  x: number;
  /** Vertical focal point, 0-100 % */
  y: number;
  /** Zoom, 100 = none */
  zoom: number;
  /** Brightness, % (100 = unchanged); missing means 100 */
  brightness?: number;
  /** Contrast, % (100 = unchanged); missing means 100 */
  contrast?: number;
}

export const DEFAULT_MEDIA_CROP: Required<MediaCrop> = {
  x: 50,
  y: 50,
  zoom: 100,
  brightness: 100,
  contrast: 100,
};

/** Build a MediaCrop from a media row (null fields fall back to defaults). */
export function mediaCrop(row: {
  cropX?: number | null;
  cropY?: number | null;
  cropZoom?: number | null;
  brightness?: number | null;
  contrast?: number | null;
}): Required<MediaCrop> {
  return {
    x: row.cropX ?? DEFAULT_MEDIA_CROP.x,
    y: row.cropY ?? DEFAULT_MEDIA_CROP.y,
    zoom: row.cropZoom ?? DEFAULT_MEDIA_CROP.zoom,
    brightness: row.brightness ?? DEFAULT_MEDIA_CROP.brightness,
    contrast: row.contrast ?? DEFAULT_MEDIA_CROP.contrast,
  };
}

/** The CSS filter for brightness/contrast, or undefined when both are 100. */
export function mediaFilter(crop: MediaCrop | null | undefined): string | undefined {
  const brightness = crop?.brightness ?? 100;
  const contrast = crop?.contrast ?? 100;
  if (brightness === 100 && contrast === 100) return undefined;
  return `brightness(${brightness}%) contrast(${contrast}%)`;
}

/**
 * Inline style for an `object-cover` image: crop when it differs from the
 * default, and the brightness/contrast filter when it differs from 100.
 * Returns undefined when there is nothing to apply.
 */
export function mediaImageStyle(crop: MediaCrop | null | undefined): CSSProperties | undefined {
  if (!crop) return undefined;
  const style: CSSProperties = {};
  if (crop.x !== 50 || crop.y !== 50) style.objectPosition = `${crop.x}% ${crop.y}%`;
  if (crop.zoom !== 100) {
    style.objectPosition = `${crop.x}% ${crop.y}%`;
    style.transform = `scale(${crop.zoom / 100})`;
    style.transformOrigin = `${crop.x}% ${crop.y}%`;
  }
  const filter = mediaFilter(crop);
  if (filter) style.filter = filter;
  return Object.keys(style).length > 0 ? style : undefined;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A cover frame's background while its image loads: the poster's main color
 * (`tone`, from its palette), 40% into the dark frame color, so it emerges
 * from the dark instead of a bright block. Undefined when there is none; the
 * frame then keeps `bg-bg-tertiary`.
 */
export function coverToneStyle(tone: string | null | undefined): CSSProperties | undefined {
  return tone && HEX.test(tone)
    ? { backgroundColor: `color-mix(in oklab, ${tone} 40%, var(--color-bg-tertiary))` }
    : undefined;
}
