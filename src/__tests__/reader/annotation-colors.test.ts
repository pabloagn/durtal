import { describe, expect, it } from "vitest";
import {
  ANNOTATION_COLOR_KEYS,
  QUIET_GLASS_ANNOTATION_PALETTE,
} from "@/lib/reader/annotation-colors";
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (values: number[]) =>
  values
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
describe("Quiet Glass annotation literals", () => {
  it("uses the authoritative key mapping and muted steel quote ink", () => {
    expect(ANNOTATION_COLOR_KEYS).toEqual({
      1: "ochre",
      2: "sage",
      3: "slate",
      4: "rose",
      5: "violet",
    });
    expect(QUIET_GLASS_ANNOTATION_PALETTE.quote).toBe("#8c9fae");
  });
  it("keeps reading and link text above 4.5:1 over every composited fill", () => {
    const background = rgb("#07090d"),
      opacity = QUIET_GLASS_ANNOTATION_PALETTE.fillOpacity;
    for (const color of Object.values(QUIET_GLASS_ANNOTATION_PALETTE.fills)) {
      const fill = rgb(color),
        blended = background.map(
          (v, i) => v * (1 - opacity) + fill[i] * opacity,
        );
      for (const foreground of ["#c5cacb", "#8c9fae"])
        expect(
          (luminance(rgb(foreground)) + 0.05) / (luminance(blended) + 0.05),
          `${foreground} over ${color}`,
        ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
