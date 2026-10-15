import { ANNOTATION_COLORS, type AnnotationColor } from "./annotations";

/** Semantic stored colours never contain theme values. The active theme resolves
 * these literal fills at rendering time, and repaint preserves decoration groups.
 */
export const ANNOTATION_COLOR_KEYS = Object.fromEntries(
  ANNOTATION_COLORS.map((color, i) => [String(i + 1), color]),
) as Record<string, AnnotationColor>;
/** Five hues a fifth of the circle apart (SLN-682): at 0.24 the old fills
 * landed within a just-noticeable difference of each other on the page. The
 * dark fills are deep so reading and link text keep 4.5:1 over them. Quotes
 * are a neutral double underline, apart from every colour. */
export const QUIET_GLASS_ANNOTATION_PALETTE = {
  fillOpacity: 0.42,
  fills: {
    ochre: "#946406",
    sage: "#2f823e",
    slate: "#087b94",
    rose: "#aa4967",
    violet: "#705eb4",
  },
  quote: "#9aa1a4",
} as const;
