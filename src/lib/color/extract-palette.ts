/**
 * Extract a color palette from an image buffer using node-vibrant + sharp.
 * Multi-pass strategy handles edge cases (mostly-black covers, monochromatic images).
 */

import type { ColorPalette, ColorSwatch } from "@/lib/types";
import { rgbToHsl, rgbToHex } from "./color-math";
import { buildCrystalPalette } from "./crystal-pipeline";

// Swatch names as node-vibrant returns them
const SWATCH_KEYS = [
  "Vibrant",
  "Muted",
  "DarkVibrant",
  "DarkMuted",
  "LightVibrant",
  "LightMuted",
] as const;

type SwatchKey = (typeof SWATCH_KEYS)[number];

// Map vibrant key names to our camelCase palette keys
const KEY_MAP: Record<SwatchKey, keyof Pick<
  ColorPalette,
  "vibrant" | "muted" | "darkVibrant" | "darkMuted" | "lightVibrant" | "lightMuted"
>> = {
  Vibrant: "vibrant",
  Muted: "muted",
  DarkVibrant: "darkVibrant",
  DarkMuted: "darkMuted",
  LightVibrant: "lightVibrant",
  LightMuted: "lightMuted",
};

/**
 * Convert a node-vibrant Swatch to our ColorSwatch type.
 * Returns null if the swatch is null/undefined.
 */
function toColorSwatch(swatch: { rgb: number[]; hex: string; population: number } | null): ColorSwatch | null {
  if (!swatch) return null;
  const rgb: [number, number, number] = [
    Math.round(swatch.rgb[0]),
    Math.round(swatch.rgb[1]),
    Math.round(swatch.rgb[2]),
  ];
  return {
    hex: swatch.hex,
    rgb,
    hsl: rgbToHsl(...rgb),
    population: swatch.population,
  };
}

/**
 * Count how many non-null swatches are in a palette result.
 */
function countSwatches(palette: Record<string, unknown>): number {
  return SWATCH_KEYS.filter((k) => palette[k] != null).length;
}

/**
 * Extract a full ColorPalette from an image buffer.
 *
 * Strategy:
 *  1. First pass: standard quality/colorCount
 *  2. If < 4 swatches, retry with higher sensitivity and no filters
 *  3. Get dominant color from sharp stats()
 *  4. Run crystal pipeline for the final render-ready palette
 */
export async function extractColorPalette(buffer: Buffer): Promise<ColorPalette> {
  const sharp = (await import("sharp")).default;
  const { Vibrant } = await import("node-vibrant/node");

  // Convert to PNG buffer — node-vibrant doesn't support WebP
  const pngBuffer = await sharp(buffer).png().toBuffer();

  // Pass 1: standard extraction
  let rawPalette = await Vibrant.from(pngBuffer)
    .quality(3)
    .maxColorCount(128)
    .getPalette();

  // Pass 2: if too few swatches, retry with higher sensitivity
  if (countSwatches(rawPalette) < 4) {
    const retryPalette = await Vibrant.from(pngBuffer)
      .quality(1)
      .maxColorCount(256)
      .clearFilters()
      .getPalette();

    if (countSwatches(retryPalette) > countSwatches(rawPalette)) {
      rawPalette = retryPalette;
    }
  }

  // Get dominant color from sharp stats (works directly with any format)
  const { dominant } = await sharp(buffer).stats();
  const dominantRgb: [number, number, number] = [
    dominant.r,
    dominant.g,
    dominant.b,
  ];

  // Build our typed palette
  const swatches: Record<string, ColorSwatch | null> = {};
  const paletteResult: Partial<ColorPalette> = {};

  for (const key of SWATCH_KEYS) {
    const vibrantSwatch = (rawPalette as Record<string, unknown>)[key] as {
      rgb: number[];
      hex: string;
      population: number;
    } | null;
    const converted = toColorSwatch(vibrantSwatch);
    const ourKey = KEY_MAP[key];
    (paletteResult as Record<string, ColorSwatch | null>)[ourKey] = converted;
    swatches[ourKey] = converted;
  }

  // Build crystal palette from swatches
  const crystal = buildCrystalPalette(swatches);

  return {
    vibrant: paletteResult.vibrant ?? null,
    muted: paletteResult.muted ?? null,
    darkVibrant: paletteResult.darkVibrant ?? null,
    darkMuted: paletteResult.darkMuted ?? null,
    lightVibrant: paletteResult.lightVibrant ?? null,
    lightMuted: paletteResult.lightMuted ?? null,
    dominant: {
      hex: rgbToHex(...dominantRgb),
      rgb: dominantRgb,
    },
    crystal,
    extractedAt: new Date().toISOString(),
  };
}
