import { ANNOTATION_COLORS, type AnnotationColor } from "./annotations";

/** Semantic stored colours never contain theme values. The active theme resolves
 * these literal fills at rendering time, and repaint preserves decoration groups.
 */
export const ANNOTATION_COLOR_KEYS = Object.fromEntries(
  ANNOTATION_COLORS.map((color, i) => [String(i + 1), color]),
) as Record<string, AnnotationColor>;
export const QUIET_GLASS_ANNOTATION_PALETTE = {
  fillOpacity: 0.24,
  fills: {
    ochre: "#afa184",
    sage: "#a3ae9c",
    slate: "#8c9fae",
    rose: "#c18b93",
    violet: "#a69db8",
  },
  quote: "#8c9fae",
} as const;
