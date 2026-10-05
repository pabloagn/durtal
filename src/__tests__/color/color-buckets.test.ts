import { describe, expect, it } from "vitest";
import {
  COLOR_BUCKETS,
  colorBucketOf,
  colorBucketOfPalette,
  editionCoverPaletteFields,
  mediaPaletteFields,
} from "@/lib/color/color-buckets";
import { hexToRgb, inkOn } from "@/lib/color/color-math";
import type { ColorPalette } from "@/lib/types";

// Cover colours (SLN-405): every dominant tone falls under one named colour

const named = (hex: string) => colorBucketOf(hexToRgb(hex));

describe("colorBucketOf", () => {
  it.each([
    ["#000000", "black"],
    ["#1c1c1c", "black"],
    ["#ffffff", "white"],
    ["#f5f5f0", "white"],
    ["#808080", "grey"],
    ["#36454f", "grey"], // charcoal
    ["#5a6475", "grey"], // slate
    ["#800000", "red"], // maroon
    ["#c0392b", "red"],
    ["#e67e22", "orange"],
    ["#ffcc99", "orange"], // peach
    ["#ffd700", "yellow"],
    ["#e1ad01", "yellow"], // mustard
    ["#2e7d32", "green"],
    ["#808000", "green"], // olive
    ["#0b3d2e", "green"], // bottle green
    ["#008080", "blue"], // teal
    ["#000080", "blue"], // navy
    ["#1a1a40", "blue"], // dark navy
    ["#4b0082", "purple"], // indigo
    ["#800080", "purple"],
    ["#ff69b4", "pink"],
    ["#f4c2c2", "pink"],
    ["#b5838d", "pink"], // dusty rose
    ["#8b4513", "brown"], // saddle brown
    ["#3b2a1a", "brown"],
    ["#d2b48c", "beige"], // tan
    ["#efe6cf", "beige"], // cream paper
    ["#fffdd0", "beige"], // cream
  ])("%s is %s", (hex, bucket) => {
    expect(named(hex)).toBe(bucket);
  });

  it.each([
    ["#380808", "red"], // oxblood
    ["#081838", "blue"], // navy
    ["#183828", "green"], // forest green
    ["#281838", "purple"], // aubergine
    ["#284848", "grey"],
    ["#282828", "black"],
    ["#281808", "black"],
  ])("deep cloth colours, as sharp's dominant tone reports them (PR #113 review): %s is %s", (hex, bucket) => {
    expect(named(hex)).toBe(bucket);
  });

  it("names every colour of the sRGB cube with a known bucket", () => {
    const keys = new Set<string>(COLOR_BUCKETS.map((b) => b.key));
    for (let r = 0; r <= 255; r += 15)
      for (let g = 0; g <= 255; g += 15)
        for (let b = 0; b <= 255; b += 15) expect(keys.has(colorBucketOf([r, g, b]))).toBe(true);
  });

  it("names each swatch as its own colour", () => {
    for (const bucket of COLOR_BUCKETS) expect(named(bucket.swatch)).toBe(bucket.key);
  });
});

describe("palette fields", () => {
  const palette = { dominant: { hex: "#c0392b", rgb: [192, 57, 43] } } as ColorPalette;

  it("names a palette by its dominant tone; none without one", () => {
    expect(colorBucketOfPalette(palette)).toBe("red");
    expect(colorBucketOfPalette(null)).toBeNull();
    expect(colorBucketOfPalette({ dominant: { hex: "#7a5c3e" } } as ColorPalette)).toBeNull();
    expect(colorBucketOfPalette({ dominant: { hex: "#000", rgb: [1, Number.NaN, 2] } } as ColorPalette)).toBeNull();
  });

  it("writes the palette and its colour together", () => {
    expect(mediaPaletteFields(palette)).toEqual({ colorPalette: palette, colorBucket: "red" });
    expect(mediaPaletteFields(null)).toEqual({ colorPalette: null, colorBucket: null });
    expect(editionCoverPaletteFields(palette)).toEqual({ coverPalette: palette, coverColorBucket: "red" });
  });
});

describe("inkOn", () => {
  it("picks the ink with the higher contrast", () => {
    expect(inkOn("#ffffff")).toBe("dark");
    expect(inkOn("#000000")).toBe("light");
    expect(inkOn("#c9a43a")).toBe("dark");
    expect(inkOn("#3e5f8e")).toBe("light");
  });
});
