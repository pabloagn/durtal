import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adaptTextColour,
  highlightColours,
  LIGHT_THEME_HIGHLIGHTS,
  READER_THEMES,
  themeColours,
} from "@/lib/reader/presentation/themes";
import {
  colourInOKLCH,
  compositeColour,
  contrastRatio,
  filterColour,
  fitBackgroundContrast,
  fitContrast,
} from "@/lib/reader/presentation/contrast";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";

describe("colour calculations", () => {
  it("uses WCAG linear-light contrast and encoded-sRGB filter order", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 12);
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 12);
    expect(contrastRatio("#808080", "#808080")).toBe(1);
    expect(filterColour("#808080", 100, 0)).toBe("#808080");
    expect(filterColour("#808080", 70, 0)).toBe("#5a5a5a");
    expect(filterColour("#808080", 100, 100)).toBe("#928a7d");
    expect(filterColour("#808080", 70, 100)).toBe("#666157");
    expect(compositeColour("#ffffff", "#000000", 0.5)).toBe("#808080");
  });
  it("rejects malformed input instead of producing invalid CSS colours", () => {
    expect(() => filterColour("var(--ink)", 100, 0)).toThrow(TypeError);
    expect(() => contrastRatio("#ffffff00", "#000000")).toThrow(TypeError);
    expect(() => filterColour("#000000", 65, 0)).toThrow(RangeError);
    expect(() => filterColour("#000000", 100, NaN)).toThrow(RangeError);
    expect(() => compositeColour("#fff", "#000", 2)).toThrow(RangeError);
    expect(() => fitContrast("#8b0000", "#222222", "#222222")).toThrow(
      RangeError,
    );
  });
  it.each(["durtal-dark", "sepia", "paper"] as const)(
    "uses theme text for neutral publisher ink in %s",
    (theme) => {
      const p = { ...PRESENTATION_DEFAULTS.desktop, theme };
      expect(adaptTextColour("#222", p)).toBe(READER_THEMES[theme].text);
      expect(adaptTextColour("#888888", p)).toBe(READER_THEMES[theme].text);
    },
  );
  it("keeps a passing chromatic colour exactly as it was", () => {
    expect(
      fitContrast(
        "#8b0000",
        READER_THEMES.paper.background,
        READER_THEMES.paper.text,
      ),
    ).toBe("#8b0000");
  });
  it("corrects the two failing Sepia fills at 70% without changing passing base colours", () => {
    const theme = READER_THEMES.sepia;
    expect(
      contrastRatio(
        filterColour(theme.text, 70, 0),
        filterColour(theme.selection, 70, 0),
      ),
    ).toBeLessThan(4.5);
    expect(
      contrastRatio(
        filterColour(theme.text, 70, 0),
        filterColour(LIGHT_THEME_HIGHLIGHTS.sepia.rose, 70, 0),
      ),
    ).toBeLessThan(4.5);
    expect(
      fitBackgroundContrast(theme.selection, theme.background, theme.text),
    ).toBe(theme.selection);
    const p = {
      ...PRESENTATION_DEFAULTS.desktop,
      theme: "sepia" as const,
      brightness: 70,
    };
    const colours = themeColours(p);
    expect(colours.selection).not.toBe(filterColour(theme.selection, 70, 0));
    expect(
      contrastRatio(colours.text, colours.selection),
    ).toBeGreaterThanOrEqual(4.5);
    expect(READER_THEMES.sepia.selection).toBe("#d3bf98");
  });
  it("retains the rubric hue while meeting contrast after every permitted filter", () => {
    const red = "#8b0000";
    const sourceHue = colourInOKLCH(red).hue;
    for (const theme of Object.values(READER_THEMES)) {
      for (const brightness of [70, 85, 100])
        for (const warmth of [0, 50, 100]) {
          const fitted = fitContrast(red, theme.background, theme.text, {
            brightness,
            warmth,
          });
          const hue = colourInOKLCH(fitted).hue;
          expect(
            Math.abs(
              Math.atan2(Math.sin(hue - sourceHue), Math.cos(hue - sourceHue)),
            ),
          ).toBeLessThan(0.05);
          expect(
            contrastRatio(
              filterColour(fitted, brightness, warmth),
              filterColour(theme.background, brightness, warmth),
            ),
          ).toBeGreaterThanOrEqual(4.5);
        }
    }
  });
});

describe("reader theme policy", () => {
  it("matches actual Quiet Glass tokens rather than the historical ticket values", () => {
    const css = readFileSync("src/styles/globals.css", "utf8");
    const tokens = {
      background: "bg-primary",
      text: "fg-primary",
      selection: "selection-bg",
      link: "accent-blue",
    } as const;
    for (const [key, token] of Object.entries(tokens)) {
      const value = css
        .match(new RegExp(`--color-${token}:\\s*(#[0-9a-f]+)`, "i"))?.[1]
        .toLowerCase();
      expect(value).toBe(
        READER_THEMES["durtal-dark"][key as keyof typeof tokens],
      );
    }
  });
  it("keeps text readable on pages, selections and the approved light highlight fills at every slider step", () => {
    for (const theme of ["durtal-dark", "sepia", "paper"] as const) {
      for (let brightness = 70; brightness <= 100; brightness += 5)
        for (let warmth = 0; warmth <= 100; warmth += 10) {
          const p = {
            ...PRESENTATION_DEFAULTS.desktop,
            theme,
            brightness,
            warmth,
          };
          const colours = themeColours(p);
          expect(
            contrastRatio(colours.text, colours.background),
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrastRatio(colours.text, colours.selection),
          ).toBeGreaterThanOrEqual(4.5);
          if (theme !== "durtal-dark")
            for (const opacity of [0.35, 0.7, 1])
              for (const fill of Object.values(
                highlightColours(p, LIGHT_THEME_HIGHLIGHTS[theme], opacity),
              ))
                expect(
                  contrastRatio(
                    colours.text,
                    compositeColour(fill, colours.background, opacity),
                  ),
                ).toBeGreaterThanOrEqual(4.5);
        }
    }
  });
});
