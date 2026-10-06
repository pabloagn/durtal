/**
 * The reader's typography settings, kept in the durtal-reader-settings
 * cookie: what Settings › Reader saves and the reader opens with. The new
 * reader's settings dialog (eBooks, sub-issue 3) reads the same cookie, and
 * sub-issue 12 replaces it with per-device preferences.
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
