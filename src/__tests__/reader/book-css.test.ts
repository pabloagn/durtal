import { describe, expect, it } from "vitest";
import { bookCSS, bookLanguage } from "@/lib/reader/presentation/book-css";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";
import { themeColours } from "@/lib/reader/presentation/themes";
import { contrastRatio } from "@/lib/reader/presentation/contrast";
import type { ReaderPresentation } from "@/lib/validations/reader-preferences";

const styles = (patch: Partial<ReaderPresentation> = {}) => {
  const presentation = { ...PRESENTATION_DEFAULTS.desktop, ...patch };
  return bookCSS(presentation, themeColours(presentation));
};
const typography =
  /\b(?:font-family|line-height|margin(?:-block)?|text-indent|text-align|hyphens|letter-spacing|word-spacing|font-weight)\s*:/;
const protectedFeatures =
  /font-feature-settings|font-variant|font-kerning|font-synthesis|::first-letter|::first-line|\bfloat\s*:/;

describe("book CSS layers", () => {
  it("leaves publisher typography to the book and only scales it", () => {
    const css = styles({
      publisherStyles: true,
      publisherScale: 110,
      fontWeight: 600,
      paragraphSpacingEm: 2,
      textAlign: "start",
    });
    expect(css.typography).toBe("body { zoom: 110%; }");
    expect(css.typography + css.colours).not.toMatch(typography);
    expect(css.typography + css.colours).not.toMatch(protectedFeatures);
  });
  it("changes the root size and block text without touching inline emphasis/features", () => {
    const css = styles();
    expect(css.typography).toContain("font-size: 20px !important");
    expect(css.typography).toContain("font-size: 1rem !important");
    expect(css.typography).toContain(
      'font-family: "Durtal Literata", Georgia, serif',
    );
    expect(css.typography).toContain("line-height: 1.5 !important");
    expect(css.typography).toContain("hyphens: auto");
    expect(css.typography).not.toMatch(
      /font-weight:|letter-spacing:|word-spacing:|margin-block:|text-indent:/,
    );
    expect(css.typography + css.colours).not.toMatch(protectedFeatures);
    for (const protectedElement of [
      "pre",
      "code",
      "kbd",
      "samp",
      "tt",
      "math",
      "svg",
    ]) {
      expect(css.typography).toContain(
        `${protectedElement}, ${protectedElement} *`,
      );
    }
  });
  it("emits nondefault block controls and zero values distinctly from Book", () => {
    const css = styles({
      fontWeight: 550,
      paragraphSpacingEm: 0,
      paragraphIndentEm: 0,
      letterSpacingEm: 0.03,
      wordSpacingEm: 0.1,
      hyphenate: false,
      textAlign: "start",
    }).typography;
    for (const declaration of [
      "font-weight: 550",
      "margin-block: 0 0em",
      "text-indent: 0em",
      "letter-spacing: 0.03em",
      "word-spacing: 0.1em",
      "hyphens: manual",
      "text-align: start",
    ])
      expect(css).toContain(declaration);
    for (const preceding of [
      "p:first-child",
      "h1 + p",
      "h6 + p",
      "hr + p",
      "blockquote + p",
      "figure + p",
      "table + p",
    ])
      expect(css).toContain(preceding);
    expect(css).not.toMatch(/\b(?:strong|b)\b[^{}]*\{[^}]*font-weight/);
  });
  it("Publisher family and Book alignment add no forced choice", () => {
    expect(
      styles({ font: "publisher", textAlign: "book" }).typography,
    ).not.toMatch(/font-family:|text-align:/);
  });
  it("keeps typography identical through colour changes", () => {
    const original = styles();
    const coloured = styles({
      theme: "paper",
      brightness: 70,
      warmth: 100,
      dimImages: true,
    });
    expect(coloured.typography).toBe(original.typography);
    expect(coloured.colours).not.toBe(original.colours);
    expect(coloured.colours).toContain("color-scheme: light");
    expect(coloured.colours).toContain("brightness(0.7) sepia(0.4)");
    expect(coloured.colours).not.toContain("brightness(0.8)");
    expect(coloured.colours).not.toMatch(
      /font-size:|line-height:|zoom:|--color-|background-image:|\b(?:fill|stroke)\s*:/,
    );
    expect(coloured.colours).toContain("svg, svg *, math, math *");
  });
  it("leaves images untouched at defaults and dims only dark-theme images", () => {
    expect(styles().colours).not.toContain("filter:");
    expect(styles({ dimImages: true }).colours).toContain(
      "img { filter: brightness(1) sepia(0) brightness(0.8)",
    );
    expect(styles({ theme: "sepia", dimImages: true }).colours).not.toContain(
      "filter:",
    );
  });
  it("writes links in the theme's accent, underlined, at 4.5:1 in every theme (SLN-681)", () => {
    for (const theme of ["durtal-dark", "sepia", "paper"] as const) {
      const css = styles({ theme });
      const ink = css.colours.match(/a:any-link, a:any-link \* \{ color: (#[0-9a-f]{6}) !important; \}/i)?.[1];
      expect(ink, theme).toBeTruthy();
      const page = themeColours({ ...PRESENTATION_DEFAULTS.desktop, theme });
      expect(contrastRatio(ink!, page.background), theme).toBeGreaterThanOrEqual(4.5);
      expect(css.colours).toContain("a:any-link { text-decoration-line: underline;");
    }
    // The dark theme's own link colour already passes and is kept
    expect(styles().colours).toContain(`color: ${themeColours(PRESENTATION_DEFAULTS.desktop).link} !important`);
  });
});

it("preserves section language before metadata/detection and handles undeclared language", () => {
  expect(bookLanguage("de", "fr", "en")).toBe("de");
  expect(bookLanguage(" ", "fr", "en")).toBe("fr");
  expect(bookLanguage(null, null, " grc ")).toBe("grc");
  expect(bookLanguage(null, "", null)).toBeNull();
});
