import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import fontAssets from "./font-assets.json";
import fontMetrics from "./font-metrics.json";

/**
 * Shipped weight ranges; publisher fonts and feature declarations remain the book's.
 * Lora, Merriweather and Libre Baskerville reserve their names under the OFL, so
 * their subsets ship as Cyreal Serif, Sorkin Serif and Baskerville; the stored
 * keys keep their first names.
 */
export const READER_FONTS = {
  literata: {
    id: "literata",
    label: "Literata",
    family: "Durtal Literata",
    fallback: "Georgia, serif",
    weightRange: [200, 900],
  },
  garamond: {
    id: "garamond",
    label: "EB Garamond",
    family: "Durtal EB Garamond",
    fallback: "Georgia, serif",
    weightRange: [400, 800],
  },
  "source-serif": {
    id: "source-serif",
    label: "Source Serif",
    family: "Durtal Source Serif",
    fallback: "Georgia, serif",
    weightRange: [200, 900],
  },
  baskerville: {
    id: "baskerville",
    label: "Baskerville",
    family: "Durtal Baskerville",
    fallback: "Georgia, serif",
    weightRange: [400, 700],
  },
  alegreya: {
    id: "alegreya",
    label: "Alegreya",
    family: "Durtal Alegreya",
    fallback: "Georgia, serif",
    weightRange: [400, 900],
  },
  lora: {
    id: "lora",
    label: "Cyreal Serif",
    family: "Durtal Cyreal Serif",
    fallback: "Georgia, serif",
    weightRange: [400, 700],
  },
  newsreader: {
    id: "newsreader",
    label: "Newsreader",
    family: "Durtal Newsreader",
    fallback: "Georgia, serif",
    weightRange: [200, 800],
  },
  merriweather: {
    id: "merriweather",
    label: "Sorkin Serif",
    family: "Durtal Sorkin Serif",
    fallback: "Georgia, serif",
    weightRange: [300, 900],
  },
  inter: {
    id: "inter",
    label: "Inter",
    family: "Durtal Inter",
    fallback: "system-ui, sans-serif",
    weightRange: [100, 900],
  },
  atkinson: {
    id: "atkinson",
    label: "Atkinson Hyperlegible",
    family: "Durtal Atkinson Hyperlegible",
    fallback: "system-ui, sans-serif",
    weightRange: [200, 800],
  },
  publisher: {
    id: "publisher",
    label: "Publisher",
    family: null,
    fallback: null,
    weightRange: null,
  },
} as const;
export type ReadingFontId = Exclude<ReaderPresentation["font"], "publisher">;

export function readingFontStack(
  font: ReaderPresentation["font"],
): string | null {
  const choice = READER_FONTS[font];
  return choice.family === null
    ? null
    : `"${choice.family}", ${choice.fallback}`;
}

/** Native canvas measurements of exact decoded shipped Latin roman faces, at 400/20px. */
export const FONT_METRIC_SAMPLE = fontMetrics.sample;
export type ReadingFontMetrics = Record<ReadingFontId, number>;
export const CHAR_WIDTH_EM: Readonly<ReadingFontMetrics> = Object.freeze(
  Object.fromEntries(
    Object.entries(fontMetrics.fonts).map(([id, font]) => [id, font.advanceEm]),
  ) as ReadingFontMetrics,
);

export const READER_FONT_VERSION = "v1";
/** Complete generated versioned inventory, including source-bound hashes for offline caching. */
export const READER_FONT_FILES = Object.freeze(
  fontAssets.files.map((file) =>
    Object.freeze({ ...file, features: Object.freeze([...file.features]) }),
  ),
);
export const READER_FONT_LICENCES = Object.freeze(
  fontAssets.licences.map((licence) => licence.path),
);

/** Blob sections require absolute font URLs, from an actual HTTP(S) origin. */
export function fontFaceCSS(origin: string, selected?: ReaderPresentation["font"]): string {
  const base = new URL(origin);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new TypeError(
      "A font origin must be an HTTP(S) origin without credentials or a path",
    );
  return READER_FONT_FILES.filter(face => selected === undefined || face.id === selected).map(
    (face) =>
      `@font-face{font-family:"${face.cssFamily}";font-style:${face.style === "roman" ? "normal" : "italic"};font-weight:${face.axes.wght.min} ${face.axes.wght.max};font-display:block;src:url("${base.origin}${face.path}") format("woff2");unicode-range:${face.unicodeRange}}`,
  ).join("\n");
}

/** For the font picker: each family's name set in its own face, from a file of only those letters */
export const READER_FONT_PREVIEWS = Object.freeze(fontAssets.previews.map((preview) => Object.freeze({ ...preview })));
export function readerFontPreviewCSS(origin: string): string {
  const base = new URL(origin).origin;
  return READER_FONT_PREVIEWS.map(
    (preview) =>
      `@font-face{font-family:"${preview.cssFamily}";font-display:swap;src:url("${base}${preview.path}") format("woff2")}`,
  ).join("\n");
}

export function readerLatinFace(
  font: ReaderPresentation["font"],
): string | null {
  if (font === "publisher") return null;
  return READER_FONT_FILES.find(
    (face) =>
      face.id === font && face.style === "roman" && face.subset === "latin",
  )!.path;
}

/** Families without native small caps or old-style figures; the browser fakes small caps */
const PLAIN_FIGURES: Partial<Record<ReaderPresentation["font"], true>> = {
  inter: true,
  atkinson: true,
  lora: true,
  newsreader: true,
  baskerville: true,
};

/** The controls retain the requested value; this describes actual font matching. */
export function readerFontCapabilityNote(
  font: ReaderPresentation["font"],
  weight: number,
): string | null {
  const choice = READER_FONTS[font];
  if (choice.weightRange && weight < choice.weightRange[0])
    return `${choice.label} starts at weight ${choice.weightRange[0]}. Lower weights use ${choice.weightRange[0]}.`;
  if (PLAIN_FIGURES[font])
    return `${choice.label} has no native small caps or old-style figures.`;
  return null;
}
