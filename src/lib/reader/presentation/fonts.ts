import type { ReaderPresentation } from "@/lib/validations/reader-preferences";

/** Family policy only. Asset manifests/axis ranges require the approved font audit. */
export const READER_FONTS = {
  literata: {
    label: "Literata",
    family: "Durtal Literata",
    fallback: "Georgia, serif",
  },
  garamond: {
    label: "EB Garamond",
    family: "Durtal EB Garamond",
    fallback: "Georgia, serif",
  },
  inter: {
    label: "Inter",
    family: "Durtal Inter",
    fallback: "system-ui, sans-serif",
  },
  publisher: { label: "Publisher", family: null, fallback: null },
} as const;

export function readingFontStack(
  font: ReaderPresentation["font"],
): string | null {
  const choice = READER_FONTS[font];
  return choice.family === null
    ? null
    : `"${choice.family}", ${choice.fallback}`;
}

/** Measure the shipped fonts against this sample; do not substitute guessed metrics. */
export const FONT_METRIC_SAMPLE =
  "The quick brown fox jumps over the lazy dog. A quiet library holds books of every age, and each page invites another reader.";
export type ReadingFontMetrics = Record<
  Exclude<ReaderPresentation["font"], "publisher">,
  number
>;

export const READER_FONT_VERSION = "v1";
const FONT_FOLDERS = ["literata", "eb-garamond", "inter"] as const;
const FONT_STYLES = ["roman", "italic"] as const;
const FONT_SUBSETS = [
  "latin",
  "latin-ext",
  "greek",
  "greek-ext",
  "cyrillic",
  "cyrillic-ext",
] as const;

/** Complete planned versioned inventory for offline caching; assets are audited separately. */
export const READER_FONT_FILES = Object.freeze(
  FONT_FOLDERS.flatMap((family) =>
    FONT_STYLES.flatMap((style) =>
      FONT_SUBSETS.map((subset) =>
        Object.freeze({
          family,
          style,
          subset,
          path: `/fonts/reader/${READER_FONT_VERSION}/${family}/${family}-${style}-${subset}.woff2`,
        }),
      ),
    ),
  ),
);
export const READER_FONT_LICENCES = Object.freeze(
  FONT_FOLDERS.map(
    (family) => `/fonts/reader/${READER_FONT_VERSION}/${family}/OFL.txt`,
  ),
);
