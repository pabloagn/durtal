import {
  mergePdfRects,
  pdfLocatorFromGeometry,
  type PdfRect,
} from "./pdf-geometry";

export interface PdfTextCluster {
  /** UTF-16 offsets in the exact page text; clusters can include ligatures. */
  start: number;
  end: number;
  /** Four measured corners in PDF user units, including rotation. */
  quad: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}
export interface PdfPageTextGeometry {
  text: string;
  /** Supplied by real glyph/ligature measurement, never item-width division. */
  clusters: readonly PdfTextCluster[];
  /** Unpainted text separators, e.g. line breaks between PDF text items. */
  separators: readonly { start: number; end: number }[];
}

/** A detached document needs measured offset coverage; empty DOMRects do not suffice. */
export function pdfRectsForTextOffsets(
  geometry: PdfPageTextGeometry,
  start: number,
  end: number,
): PdfRect[] | null {
  if (
    ![start, end].every(Number.isSafeInteger) ||
    start < 0 ||
    end <= start ||
    end > geometry.text.length
  )
    return null;
  const pieces: { start: number; end: number; rect?: PdfRect }[] = [];
  for (const cluster of geometry.clusters) {
    if (
      !Number.isSafeInteger(cluster.start) ||
      !Number.isSafeInteger(cluster.end) ||
      cluster.start < 0 ||
      cluster.end <= cluster.start ||
      cluster.end > geometry.text.length ||
      cluster.quad.length !== 8 ||
      !cluster.quad.every(Number.isFinite)
    )
      return null;
    if (cluster.end <= start || cluster.start >= end) continue;
    const [x0, y0, x1, y1, x2, y2, x3, y3] = cluster.quad;
    const rect: PdfRect = [
      Math.min(x0, x1, x2, x3),
      Math.min(y0, y1, y2, y3),
      Math.max(x0, x1, x2, x3),
      Math.max(y0, y1, y2, y3),
    ];
    if (rect[0] >= rect[2] || rect[1] >= rect[3]) return null;
    pieces.push({ start: cluster.start, end: cluster.end, rect });
  }
  for (const separator of geometry.separators) {
    if (
      !Number.isSafeInteger(separator.start) ||
      !Number.isSafeInteger(separator.end) ||
      separator.start < 0 ||
      separator.end <= separator.start ||
      separator.end > geometry.text.length ||
      !/^\s+$/.test(geometry.text.slice(separator.start, separator.end))
    )
      return null;
    if (separator.end > start && separator.start < end) pieces.push(separator);
  }
  pieces.sort((a, b) => a.start - b.start || a.end - b.end);
  let covered = start;
  const rects: PdfRect[] = [];
  for (const piece of pieces) {
    if (piece.start > covered) return null;
    covered = Math.max(covered, piece.end);
    if (piece.rect) rects.push(piece.rect);
  }
  if (covered < end || !rects.length) return null;
  const merged = mergePdfRects(rects);
  return merged.length ? merged : null;
}

/** Same storage builder as selection, without requiring a connected document. */
export function pdfLocatorFromTextOffsets(
  geometry: PdfPageTextGeometry,
  start: number,
  end: number,
  context: Omit<Parameters<typeof pdfLocatorFromGeometry>[0], "rects" | "text">,
) {
  const rects = pdfRectsForTextOffsets(geometry, start, end);
  if (!rects) return null;
  return pdfLocatorFromGeometry({
    ...context,
    rects,
    text: {
      highlight: geometry.text.slice(start, end),
      before: geometry.text.slice(0, start),
      after: geometry.text.slice(end),
    },
  });
}
