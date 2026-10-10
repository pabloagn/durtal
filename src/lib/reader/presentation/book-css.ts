import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import { readingFontStack } from "./fonts";
import type { ReaderTheme } from "./themes";

const BLOCK_TEXT = "body, p, li, dd, dt, blockquote, figcaption, td, th";
const FAMILY_TEXT =
  "body, body *:not(pre, pre *, code, code *, kbd, kbd *, samp, samp *, tt, tt *, math, math *, svg, svg *)";
const COLOUR_TEXT = "body *:not(svg, svg *, math, math *)";

/** Own the layers separately so a colour-only edit never invokes paginator reflow. */
export interface BookStyles {
  typography: string;
  colours: string;
}

/** Font faces are installed separately after the source-bound asset manifest exists. */
export function bookCSS(
  p: ReaderPresentation,
  colours: ReaderTheme,
): BookStyles {
  const typography: string[] = [];
  if (p.publisherStyles)
    typography.push(`body { zoom: ${p.publisherScale}%; }`);
  else {
    typography.push(
      `html { font-size: ${p.fontSizePx}px !important; }`,
      "body { font-size: 1rem !important; }",
    );
    const family = readingFontStack(p.font);
    if (family)
      typography.push(`${FAMILY_TEXT} { font-family: ${family} !important; }`);
    typography.push(
      `${BLOCK_TEXT} { line-height: ${p.lineHeight} !important; hyphens: ${p.hyphenate ? "auto" : "manual"} !important; -webkit-hyphens: ${p.hyphenate ? "auto" : "manual"} !important; }`,
    );
    if (p.fontWeight !== 400)
      typography.push(
        `${BLOCK_TEXT} { font-weight: ${p.fontWeight} !important; }`,
      );
    if (p.letterSpacingEm !== 0)
      typography.push(
        `${BLOCK_TEXT} { letter-spacing: ${p.letterSpacingEm}em !important; }`,
      );
    if (p.wordSpacingEm !== 0)
      typography.push(
        `${BLOCK_TEXT} { word-spacing: ${p.wordSpacingEm}em !important; }`,
      );
    if (p.paragraphSpacingEm !== null)
      typography.push(
        `p { margin-block: 0 ${p.paragraphSpacingEm}em !important; }`,
      );
    if (p.paragraphIndentEm !== null)
      typography.push(
        `p { text-indent: ${p.paragraphIndentEm}em !important; }`,
        "p:first-child, h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p, hr + p, blockquote + p, figure + p, table + p { text-indent: 0 !important; }",
      );
    if (p.textAlign !== "book")
      typography.push(`body { text-align: ${p.textAlign}; }`);
  }
  const mediaFilter = `brightness(${p.brightness / 100}) sepia(${(0.4 * p.warmth) / 100})`;
  const dim =
    p.theme === "durtal-dark" && p.dimImages ? " brightness(0.8)" : "";
  const filters = p.brightness !== 100 || p.warmth !== 0;
  const mediaRules = filters
    ? `img, svg, video, canvas { filter: ${mediaFilter}; }`
    : "";
  const imageRules = dim ? `img { filter: ${mediaFilter}${dim}; }` : "";
  return {
    typography: typography.join("\n"),
    colours: [
      `html, body { color-scheme: ${colours.colorScheme}; background-color: ${colours.background} !important; color: ${colours.text} !important; }`,
      `${COLOUR_TEXT} { background-color: transparent !important; }`,
      `::selection { background-color: ${colours.selection}; color: ${colours.text}; }`,
      `:where(a) { color: ${colours.text}; text-decoration-line: underline; text-decoration-color: ${colours.link}; }`,
      mediaRules,
      imageRules,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Preserve per-section/passage language; use the file's detected language last. */
export function bookLanguage(
  documentLanguage: string | null,
  metadataLanguage: string | null,
  textLanguage: string | null,
): string | null {
  return (
    [documentLanguage, metadataLanguage, textLanguage]
      .find((language) => language?.trim())
      ?.trim() ?? null
  );
}
