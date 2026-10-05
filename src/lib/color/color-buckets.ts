/**
 * Cover colours (SLN-405): every cover falls under one named colour, the
 * colour of its dominant tone (`ColorPalette.dominant`, the most common
 * colour in the image). The library's colour filter offers these, in this
 * order. A cover's colour is stored beside its palette (`media.color_bucket`,
 * `editions.cover_color_bucket`) whenever a palette is written, so the filter
 * is one column.
 */
import type { ColorPalette } from "@/lib/types";
import { rgbToHsl } from "./color-math";

export const COLOR_BUCKETS = [
  // `swatch`: the filter's swatch, muted like the rest of the interface
  { key: "red", label: "Red", swatch: "#a23b3b" },
  { key: "orange", label: "Orange", swatch: "#bf6a2e" },
  { key: "yellow", label: "Yellow", swatch: "#cdb043" },
  { key: "green", label: "Green", swatch: "#4f7a4c" },
  { key: "blue", label: "Blue", swatch: "#3e5f8e" },
  { key: "purple", label: "Purple", swatch: "#6c4f8c" },
  { key: "pink", label: "Pink", swatch: "#c07a96" },
  { key: "brown", label: "Brown", swatch: "#6f4c33" },
  { key: "beige", label: "Beige", swatch: "#d4c6a2" },
  { key: "white", label: "White", swatch: "#efece6" },
  { key: "grey", label: "Grey", swatch: "#85858a" },
  { key: "black", label: "Black", swatch: "#141414" },
] as const;

export type ColorBucket = (typeof COLOR_BUCKETS)[number]["key"];

export const COLOR_BUCKET_KEYS = COLOR_BUCKETS.map((b) => b.key) as [ColorBucket, ...ColorBucket[]];

/** Each colour by key: `COLOR_BUCKET.red.label` */
export const COLOR_BUCKET = Object.fromEntries(COLOR_BUCKETS.map((b) => [b.key, b])) as {
  [K in ColorBucket]: Extract<(typeof COLOR_BUCKETS)[number], { key: K }>;
};

/**
 * The named colour of one sRGB colour. Lightness first (black, white), then
 * how grey it is, then its hue. Light and dusty reds read as pink; dark or dull oranges
 * and reds as brown; light, dull warm tones (cream, tan, sand) as beige.
 */
export function colorBucketOf(rgb: readonly [number, number, number]): ColorBucket {
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  // Chroma: how far the colour is from grey, 0 to 100, whatever its lightness
  const c = ((Math.max(...rgb) - Math.min(...rgb)) / 255) * 100;

  if (l < 14 || (l < 22 && c < 10)) return "black";
  if (l > 95 || (l > 88 && c < 16)) return "white";
  // Dark, nearly grey and cool (charcoal, slate) reads as grey; warm reads as brown
  if (c < 6 || s < 15 || (l < 35 && c < 14 && h >= 60 && h < 330)) return "grey";

  // Red: either side of 0°
  if (h < 12 || h >= 345) {
    if (l >= 70 || (l >= 50 && s < 40)) return "pink";
    if (l < 42 && s < 35) return "brown";
    return "red";
  }
  // Orange, with its dark (brown) and light, dull (beige) tones
  if (h < 42) {
    if (l >= 70) return c < 30 || s < 60 ? "beige" : "orange";
    if (l < 32 || (l < 45 && s < 70)) return "brown";
    if (s < 45) return l >= 55 ? "beige" : "brown";
    return "orange";
  }
  // Yellow, with cream (beige), olive (green) and dark mustard (brown)
  if (h < 68) {
    if (l >= 70) return c < 30 ? "beige" : "yellow";
    if (l < 30) return h < 55 ? "brown" : "green";
    if (s < 45) return l >= 55 ? "beige" : "brown";
    return "yellow";
  }
  if (h < 170) return "green";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  // Magenta and rose: pink, or purple when dark
  return l < 35 ? "purple" : "pink";
}

/** A palette's colour: the colour of its dominant tone; none without one */
export function colorBucketOfPalette(palette: Pick<ColorPalette, "dominant"> | null | undefined): ColorBucket | null {
  const rgb = palette?.dominant?.rgb;
  if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every((v) => Number.isFinite(v))) return null;
  return colorBucketOf([rgb[0], rgb[1], rgb[2]]);
}

/** A work poster's palette columns: the palette and its colour, always written together */
export function mediaPaletteFields(palette: ColorPalette | null) {
  return { colorPalette: palette, colorBucket: colorBucketOfPalette(palette) };
}

/** An edition cover's palette columns, written with the cover's keys */
export function editionCoverPaletteFields(palette: ColorPalette | null) {
  return { coverPalette: palette, coverColorBucket: colorBucketOfPalette(palette) };
}
