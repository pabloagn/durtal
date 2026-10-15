import { describe, expect, it } from "vitest";
import {
  ANNOTATION_COLOR_KEYS,
  QUIET_GLASS_ANNOTATION_PALETTE,
} from "@/lib/reader/annotation-colors";
import { colourInOKLCH } from "@/lib/reader/presentation/contrast";
import { highlightColours, LIGHT_THEME_HIGHLIGHTS, markInk, READER_THEMES } from "@/lib/reader/presentation/themes";
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const hex = (values: number[]) =>
  `#${values.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
/** What the page shows where a fill, drawn above it, meets one colour of it */
const inked = (under: string, fill: string, ink: ReturnType<typeof markInk>) => {
  const [u, f] = [rgb(under), rgb(fill)];
  return hex(u.map((v, i) => {
    const blended = ink.blend === "lighten" ? Math.max(v, f[i]) : v * f[i];
    return v * (1 - ink.opacity) + blended * ink.opacity;
  }));
};
const luminance = (values: number[]) =>
  values
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
describe("Quiet Glass annotation literals", () => {
  it("uses the authoritative key mapping and a neutral quote ink", () => {
    expect(ANNOTATION_COLOR_KEYS).toEqual({
      1: "ochre",
      2: "sage",
      3: "slate",
      4: "rose",
      5: "violet",
    });
    expect(QUIET_GLASS_ANNOTATION_PALETTE.quote).toBe("#9aa1a4");
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
  // OKLab distance: about 0.02 is just noticeable; the old fills were 0.008 to 0.011 apart
  const oklab = (hex: string) => {
    const { lightness, chroma, hue } = colourInOKLCH(hex);
    return [lightness, chroma * Math.cos(hue), chroma * Math.sin(hue)];
  };
  const distance = (a: string, b: string) => {
    const [x, y] = [oklab(a), oklab(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  it.each(["durtal-dark", "sepia", "paper"] as const)(
    "keeps the five marks clearly apart on the page, and from it, in %s (SLN-682)",
    (theme) => {
      const { background } = READER_THEMES[theme];
      const ink = markInk(theme);
      const source = theme === "durtal-dark" ? QUIET_GLASS_ANNOTATION_PALETTE.fills : LIGHT_THEME_HIGHLIGHTS[theme];
      const fills = highlightColours({ theme, brightness: 100, warmth: 0 } as never, source, ink.opacity);
      const shown = Object.values(fills).map((fill) => inked(background, fill, ink));
      for (const [i, a] of shown.entries()) {
        expect(distance(a, background)).toBeGreaterThanOrEqual(0.04);
        for (const b of shown.slice(i + 1)) expect(distance(a, b)).toBeGreaterThanOrEqual(0.035);
      }
    },
  );
  // The fills are drawn above the text: the blend must leave the letters as
  // dark (or as light) as the page's own, which a plain fill would not (SLN-682)
  it.each(["durtal-dark", "sepia", "paper"] as const)(
    "keeps reading text at 4.5:1 inside every mark in %s, drawn above it",
    (theme) => {
      const { background, text } = READER_THEMES[theme];
      const ink = markInk(theme);
      const source = theme === "durtal-dark" ? QUIET_GLASS_ANNOTATION_PALETTE.fills : LIGHT_THEME_HIGHLIGHTS[theme];
      for (const fill of Object.values(highlightColours({ theme, brightness: 100, warmth: 0 } as never, source, ink.opacity))) {
        const [letters, paper] = [luminance(rgb(inked(text, fill, ink))), luminance(rgb(inked(background, fill, ink)))];
        expect(
          (Math.max(letters, paper) + 0.05) / (Math.min(letters, paper) + 0.05),
          `${theme} ${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  it("gives quotes an ink apart from every colour", () => {
    for (const fill of Object.values(QUIET_GLASS_ANNOTATION_PALETTE.fills))
      expect(distance(QUIET_GLASS_ANNOTATION_PALETTE.quote, fill)).toBeGreaterThanOrEqual(0.1);
    expect(colourInOKLCH(QUIET_GLASS_ANNOTATION_PALETTE.quote).chroma).toBeLessThan(0.02);
  });
});
