/**
 * Zod-free half of the image adjustment helpers. Client components import this
 * module so the validation library stays out of the shared browser bundle.
 */

import { mediaUrl } from "@/lib/s3/media-url";

export interface ImageAdjustments {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  sepia: number;
  softness: number;
}

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  exposure: 0,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0,
  sepia: 0,
  softness: 0,
};

export function enforceImagePolicy(
  settings: ImageAdjustments,
  monochrome: boolean,
): ImageAdjustments {
  return monochrome
    ? { ...settings, saturation: 100, grayscale: 100, sepia: 0 }
    : settings;
}

/** Shared by the editor and every stored-image display; exposure is measured in stops. */
export function imageAdjustmentFilter(
  settings: ImageAdjustments,
  monochrome = false,
): string {
  const s = enforceImagePolicy(settings, monochrome);
  const brightness = Number(
    (s.brightness * Math.pow(2, s.exposure)).toFixed(4),
  );
  return `brightness(${brightness}%) contrast(${s.contrast}%) saturate(${s.saturation}%) grayscale(${s.grayscale}%) sepia(${s.sepia}%) blur(${s.softness}px)`;
}

export function s3ImageSource(key: string): string {
  return mediaUrl(key);
}

/** Only app-owned image routes are editable. Never fetch an arbitrary supplied URL. */
export function imageSourceIdentity(
  source: string,
): { key: string } | { calibreId: number } | null {
  if (!source.startsWith("/") || source.startsWith("//")) return null;
  const url = new URL(source, "https://durtal.invalid");
  if (url.pathname === "/api/s3/read") {
    const key = url.searchParams.get("key");
    return key && key.length <= 1024 ? { key } : null;
  }
  const reader = url.pathname.match(/^\/api\/reader\/(\d+)\/cover$/);
  if (reader && Number.isSafeInteger(Number(reader[1])))
    return { calibreId: Number(reader[1]) };
  return null;
}

export interface StoredImageAdjustments {
  assetKey: string;
  sources: string[];
  settings: ImageAdjustments;
  monochrome: boolean;
}

function selectorFor(source: string): string {
  // encodeURIComponent-generated URLs plus JSON quoting prevent selector injection.
  const quote = (value: string) => JSON.stringify(value).replace(/</g, "\\3c ");
  const direct = `img[src=${quote(source)}]`;
  const retry = `img[src^=${quote(source + (source.includes("?") ? "&" : "?"))}]`;
  const optimized = `img[src^=${quote("/_next/image?url=" + encodeURIComponent(source) + "&")}]`;
  return [direct, retry, optimized]
    .map((s) => `${s}:not([data-adjustment-preview])`)
    .join(",");
}

/** One CSS rule for settings that are already valid; empty when no source is a stored asset. */
export function imageAdjustmentRule(row: StoredImageAdjustments): string {
  const sources = row.sources.filter((source) => imageSourceIdentity(source));
  if (!sources.length) return "";
  return `${sources.map(selectorFor).join(",")} { filter: ${imageAdjustmentFilter(row.settings, row.monochrome)} !important; }`;
}
