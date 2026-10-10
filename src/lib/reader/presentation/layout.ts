import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import type { ReadingFontMetrics } from "./fonts";

const LINE_CHARACTERS = { narrow: 55, medium: 66, wide: 80 } as const;

export interface LayoutContext {
  reducedMotion: boolean;
  /** Source-bound measurements of the eventual shipped files, supplied by the adapter. */
  fontMetrics: ReadingFontMetrics;
}

/** All values are paginator attributes, not injected publisher typography. */
export function paginatorAttributes(
  p: ReaderPresentation,
  hostSize: { width: number; height: number },
  info: LayoutContext,
) {
  if (
    ![hostSize.width, hostSize.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new RangeError(
      "The reading area must have a positive width and height",
    );
  const columns =
    p.flow === "scrolled" || p.spread === "none"
      ? 1
      : p.spread === "both"
        ? 2
        : hostSize.width >= 1000 && hostSize.width > hostSize.height
          ? 2
          : 1;
  const advance =
    p.publisherStyles || p.font === "publisher"
      ? 0.5
      : info.fontMetrics[p.font];
  if (!Number.isFinite(advance) || advance <= 0)
    throw new RangeError("A measured font advance is required for line length");
  const size = p.publisherStyles ? (16 * p.publisherScale) / 100 : p.fontSizePx;
  const lineWidth =
    p.lineLength === "full"
      ? 4000
      : Math.round(LINE_CHARACTERS[p.lineLength] * advance * size);
  return {
    flow: p.flow,
    "max-column-count": String(columns),
    "max-inline-size": `${lineWidth}px`,
    "margin-left": `${p.marginPx}px`,
    "margin-right": `${p.marginPx}px`,
    "column-gap": `${2 * p.marginPx}px`,
    animated:
      p.flow === "paginated" && p.pageTurn === "slide" && !info.reducedMotion,
  };
}
