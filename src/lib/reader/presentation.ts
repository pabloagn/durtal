import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import { readingFontStack } from "./presentation/fonts";
import { routeFontPresentation } from "./presentation/font-route";
import { themeColours } from "./presentation/themes";
import { bookCSS } from "./presentation/book-css";
import type { Presentation } from "./engine";
import { READER_FONT_FAMILIES } from "./fonts";
import type { ReaderThemeSettings } from "./settings-cookie";

/**
 * How a book looks inside the reader (eBooks sub-issue 3): the five settings
 * of the durtal-reader-settings cookie and the Durtal dark theme, as one
 * Presentation the engine applies. The book's frames cannot see the app's
 * CSS variables, so the theme's tokens are resolved to literal colours here.
 * Sub-issue 12 replaces the settings with per-device preferences.
 */

export const THEME_TOKENS = {
  background: "--color-bg-primary",
  text: "--color-fg-primary",
  link: "--color-accent-blue-text",
  selection: "--color-selection-bg",
  muted: "--color-fg-secondary",
} as const satisfies Record<keyof Presentation["colors"], string>;

/** The dark theme's values, for when the document cannot be read (tests, the server) */
const FALLBACK_COLORS: Presentation["colors"] = {
  background: "#07090d",
  text: "#c5cacb",
  link: "#8c9fae",
  selection: "#17232d",
  muted: "#9ba4ad",
};

/** The theme tokens as literal colours, read from the app's root element */
export function resolveThemeColors(
  root: Element | null = typeof document === "undefined"
    ? null
    : document.documentElement,
): Presentation["colors"] {
  if (!root) return FALLBACK_COLORS;
  const style = getComputedStyle(root);
  const read = (key: keyof Presentation["colors"]) =>
    style.getPropertyValue(THEME_TOKENS[key]).trim() || FALLBACK_COLORS[key];
  return {
    background: read("background"),
    text: read("text"),
    link: read("link"),
    selection: read("selection"),
    muted: read("muted"),
  };
}

const FONT_STACKS: Record<ReaderThemeSettings["fontFamily"], string | null> = {
  serif: `${READER_FONT_FAMILIES.serif}, Georgia, serif`,
  sans: `${READER_FONT_FAMILIES.sans}, system-ui, sans-serif`,
  system: "system-ui, -apple-system, sans-serif",
  publisher: null,
};

export function presentationFrom(
  settings: ReaderThemeSettings,
  colors: Presentation["colors"],
  fontFaces: string,
): Presentation {
  return {
    fontFamily: FONT_STACKS[settings.fontFamily],
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    margin: settings.margin,
    textAlign: settings.textAlign,
    colors,
    fontFaces,
  };
}

// srcdoc sections are HTML: epub:type is a literal attribute there, rather
// than the namespaced attribute used by the original XHTML publication.
const HTML_NOTE_CSS = String.raw`aside[epub\:type~="footnote"], aside[epub\:type~="endnote"], aside[epub\:type~="note"], aside[epub\:type~="rearnote"] { display: none; }`;

/** The styles written into each section of the book */
export function presentationCss(p: Presentation): string {
  const { background, text, link, selection } = p.colors;
  const font = p.fontFamily
    ? `body, body *:not(pre, code, kbd, samp, pre *, code *, math, math *) { font-family: ${p.fontFamily} !important; }`
    : "";
  return `${p.fontFaces}
@namespace epub "http://www.idpf.org/2007/ops";
html { color-scheme: dark; background: ${background} !important; color: ${text} !important; font-size: ${p.fontSize}px !important; }
body { background: transparent !important; color: ${text} !important; font-size: 1rem !important; }
body *:not(a, a *, svg, svg *, math, math *) { color: inherit !important; background-color: transparent !important; }
a[data-durtal-external]::after { content: "\u2197\ufe0e"; padding-inline-start: .2em; font-size: .8em; }
figure { break-inside: avoid; }
aside[role~="doc-footnote"], aside[role~="doc-endnote"] { display: none; }
a, a * { color: ${link} !important; }
${font}
body, p, li, blockquote, dd, dt, td, th { line-height: ${p.lineHeight} !important; }
p, li, blockquote, dd { text-align: ${p.textAlign === "justify" ? "justify" : "start"}; hyphens: ${p.textAlign === "justify" ? "auto" : "manual"}; -webkit-hyphens: ${p.textAlign === "justify" ? "auto" : "manual"}; widows: 2; orphans: 2; }
[align="center"] { text-align: center; }
[align="right"] { text-align: right; }
pre { white-space: pre-wrap !important; }
:focus-visible { outline: 2px solid ${text} !important; outline-offset: 2px !important; }
/* Focus a jump or the reader moves to a paragraph is not a keyboard stop: no box (SLN-681) */
[tabindex="-1"]:focus-visible { outline: none !important; }
@media (prefers-reduced-motion: reduce) { html, body, body * { scroll-behavior: auto !important; animation-duration: 0s !important; transition-duration: 0s !important; } }
::selection { background: ${selection}; color: ${text}; }
aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
${HTML_NOTE_CSS}
`;
}

/** Mounted readers consume acknowledged rows plus the saver's durable draft preview. */
export function presentationFromPreferences(policy: ReaderPresentation, origin: string): Presentation {
  const theme = themeColours(policy);
  return routeFontPresentation({
    policy, fontFamily: readingFontStack(policy.font), fontSize: policy.fontSizePx,
    lineHeight: policy.lineHeight, margin: 0, textAlign: policy.textAlign === "justify" ? "justify" : "left",
    colors: { background: theme.background, text: theme.text, link: theme.link,
      selection: theme.selection, muted: theme.text }, fontFaces: "",
  }, origin);
}

/** Reader-owned structural rules remain separate from publisher typography. */
export function policyTypographyCss(p: Presentation): string {
  if (!p.policy) return presentationCss(p);
  return `@namespace epub "http://www.idpf.org/2007/ops";
${p.fontFaces}
${bookCSS(p.policy, themeColours(p.policy), p.fontFamily).typography}
a[data-durtal-external]::after { content: "\u2197\ufe0e"; padding-inline-start: .2em; font-size: .8em; }
figure { break-inside: avoid; }
pre { white-space: pre-wrap !important; }
aside[role~="doc-footnote"], aside[role~="doc-endnote"], aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
${HTML_NOTE_CSS}
:focus-visible { outline: 2px solid currentColor !important; outline-offset: 2px !important; }
/* Focus a jump or the reader moves to a paragraph is not a keyboard stop: no box (SLN-681) */
[tabindex="-1"]:focus-visible { outline: none !important; }
@media (prefers-reduced-motion: reduce) { html, body, body * { scroll-behavior: auto !important; animation-duration: 0s !important; transition-duration: 0s !important; } }
`;
}
