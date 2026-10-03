/**
 * Durtal EPUB Theme — CSS injected into the epub.js rendering iframe.
 *
 * This controls every pixel of how book content looks. The epub.js engine
 * is invisible; readers see only our typography and color palette.
 */

export interface ReaderThemeSettings {
  fontSize: number; // px
  fontFamily: "sans" | "serif" | "system" | "publisher";
  lineHeight: number; // unitless multiplier
  margin: number; // percentage of viewport width
  textAlign: "left" | "justify";
}

export const READER_DEFAULTS: ReaderThemeSettings = {
  fontSize: 18,
  fontFamily: "sans",
  lineHeight: 1.8,
  margin: 12,
  textAlign: "left",
};

// The choices the reader offers: its settings panel and Settings → Reader
export const READER_FONTS: { value: ReaderThemeSettings["fontFamily"]; label: string }[] = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "system", label: "System" },
  { value: "publisher", label: "Original" },
];
export const READER_FONT_SIZES = [14, 16, 18, 20, 22, 24, 26, 28];
export const READER_LINE_HEIGHTS = [1.4, 1.6, 1.8, 2, 2.2, 2.4];
export const READER_MARGINS = [4, 8, 12, 16, 20];
export const READER_ALIGNMENTS: { value: ReaderThemeSettings["textAlign"]; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "justify", label: "Justify" },
];

/** Stored settings over the defaults: a value the reader does not offer gives the default. */
export function readerSettings(stored: unknown): ReaderThemeSettings {
  const saved = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const pick = <T,>(value: unknown, offered: readonly T[], fallback: T): T =>
    offered.includes(value as T) ? (value as T) : fallback;
  return {
    fontFamily: pick(saved.fontFamily, READER_FONTS.map((f) => f.value), READER_DEFAULTS.fontFamily),
    fontSize: pick(saved.fontSize, READER_FONT_SIZES, READER_DEFAULTS.fontSize),
    lineHeight: pick(saved.lineHeight, READER_LINE_HEIGHTS, READER_DEFAULTS.lineHeight),
    margin: pick(saved.margin, READER_MARGINS, READER_DEFAULTS.margin),
    textAlign: pick(saved.textAlign, READER_ALIGNMENTS.map((a) => a.value), READER_DEFAULTS.textAlign),
  };
}

export const READER_FONT_STACKS: Record<ReaderThemeSettings["fontFamily"], string> = {
  sans: '"Inter", system-ui, sans-serif',
  serif: '"PPCirka", "EB Garamond", Georgia, serif',
  system: "system-ui, sans-serif",
  publisher: "inherit",
};

export function generateReaderCSS(settings: ReaderThemeSettings): string {
  const fontFamily = READER_FONT_STACKS[settings.fontFamily] ?? READER_FONT_STACKS.sans;
  const important = settings.fontFamily === "publisher" ? "" : "!important";

  return `
    /* ── Durtal Reader Theme ─────────────────────────────────────────── */

    html, body {
      background: #030507 !important;
      color: #c1c6c4 !important;
    }

    body {
      font-family: ${fontFamily} ${important};
      font-size: ${settings.fontSize}px !important;
      line-height: ${settings.lineHeight} !important;
      text-align: ${settings.textAlign} !important;
      -webkit-font-smoothing: antialiased !important;
      -moz-osx-font-smoothing: grayscale !important;
    }

    /* Headings — always serif */
    h1, h2, h3, h4, h5, h6 {
      font-family: "PPCirka", "EB Garamond", Georgia, serif !important;
      color: #c1c6c4 !important;
      font-weight: 400 !important;
      letter-spacing: 0.01em !important;
      margin-top: 1.5em !important;
      margin-bottom: 0.5em !important;
    }

    h1 { font-size: 1.75em !important; }
    h2 { font-size: 1.5em !important; }
    h3 { font-size: 1.25em !important; }

    /* Paragraphs */
    p {
      color: #c1c6c4 !important;
      margin-bottom: 0.75em !important;
      orphans: 2 !important;
      widows: 2 !important;
    }

    /* Links — muted blue */
    a, a:visited {
      color: #648493 !important;
      text-decoration: none !important;
      border-bottom: 1px solid rgba(100, 132, 147, 0.3) !important;
    }
    a:hover {
      border-bottom-color: #648493 !important;
    }

    /* Images — slightly dimmed for dark mode */
    img, svg {
      max-width: 100% !important;
      height: auto !important;
      filter: brightness(0.85) !important;
    }

    /* Block quotes — subtle accent */
    blockquote {
      border-left: 2px solid #7d3d52 !important;
      padding-left: 1em !important;
      margin-left: 0 !important;
      color: #7d8380 !important;
      font-style: italic !important;
    }

    /* Code blocks */
    code, pre {
      font-family: "JetBrains Mono", "SF Mono", monospace !important;
      font-size: 0.85em !important;
      background: #0a0d10 !important;
      color: #c1c6c4 !important;
      border-radius: 2px !important;
    }
    pre {
      padding: 1em !important;
      overflow-x: auto !important;
    }
    code {
      padding: 0.15em 0.3em !important;
    }

    /* Tables */
    table {
      border-collapse: collapse !important;
      width: 100% !important;
    }
    th, td {
      border: 1px solid #14171c !important;
      padding: 0.5em 0.75em !important;
      color: #c1c6c4 !important;
    }
    th {
      background: #0a0d10 !important;
      font-weight: 600 !important;
    }

    /* Horizontal rules */
    hr {
      border: none !important;
      border-top: 1px solid #14171c !important;
      margin: 2em 0 !important;
    }

    /* Lists */
    ul, ol {
      color: #c1c6c4 !important;
      padding-left: 1.5em !important;
    }
    li {
      margin-bottom: 0.25em !important;
    }

    /* Selection */
    ::selection {
      background-color: #20131e !important;
      color: #c1c6c4 !important;
    }

    /* Footnotes and superscripts */
    sup, sub {
      color: #7d8380 !important;
    }

    /* Remove any publisher background colors */
    div, section, article, aside, main, nav, header, footer, figure, figcaption {
      background-color: transparent !important;
      color: inherit !important;
    }

    /* Ensure nothing is hidden by publisher CSS */
    * {
      visibility: visible !important;
    }
  `;
}
