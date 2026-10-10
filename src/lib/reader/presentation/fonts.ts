import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import fontAssets from "./font-assets.json";
import fontMetrics from "./font-metrics.json";

/** Shipped weight ranges; publisher fonts and feature declarations remain the book's. */
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
  inter: {
    id: "inter",
    label: "Inter",
    family: "Durtal Inter",
    fallback: "system-ui, sans-serif",
    weightRange: [100, 900],
  },
  publisher: {
    id: "publisher",
    label: "Publisher",
    family: null,
    fallback: null,
    weightRange: null,
  },
} as const;

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
export const CHAR_WIDTH_EM = Object.freeze({
  literata: fontMetrics.fonts.literata.advanceEm,
  garamond: fontMetrics.fonts.garamond.advanceEm,
  inter: fontMetrics.fonts.inter.advanceEm,
});
export type ReadingFontMetrics = Record<
  Exclude<ReaderPresentation["font"], "publisher">,
  number
>;

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
export function fontFaceCSS(origin: string): string {
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
  return READER_FONT_FILES.map(
    (face) =>
      `@font-face{font-family:"${face.cssFamily}";font-style:${face.style === "roman" ? "normal" : "italic"};font-weight:${face.axes.wght.min} ${face.axes.wght.max};font-display:block;src:url("${base.origin}${face.path}") format("woff2");unicode-range:${face.unicodeRange}}`,
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

/** The controls retain the requested value; this describes actual font matching. */
export function readerFontCapabilityNote(
  font: ReaderPresentation["font"],
  weight: number,
): string | null {
  if (font === "garamond" && weight < 400)
    return "EB Garamond starts at weight 400. Lower weights use 400.";
  if (font === "inter")
    return "Inter has no native small caps or old-style figures.";
  return null;
}
