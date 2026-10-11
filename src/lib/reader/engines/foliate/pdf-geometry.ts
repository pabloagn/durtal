import type { DurtalLocator } from "@/lib/reader/engine";

export type PdfRect = [number, number, number, number];
export interface ClientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** Structural subset of pdf.js PageViewport. No pdf.js import or DOM lookup. */
export interface PdfViewport {
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportRectangle(rect: number[]): number[];
}
export interface PageOffset {
  /** Client coordinates of the cropped page frame. */
  left: number;
  top: number;
  /** Removed left/top margins in the current viewport's CSS pixels. */
  cropLeft: number;
  cropTop: number;
}

const round = (n: number) => {
  const value = Math.round(n * 100) / 100;
  return Object.is(value, -0) ? 0 : value;
};

export function validPdfRect(rect: readonly number[]): boolean {
  return (
    rect.length === 4 &&
    rect.every(Number.isFinite) &&
    rect[0] < rect[2] &&
    rect[1] < rect[3]
  );
}

/** Normalize all four corners, so 90/180/270-degree viewports work too. */
export function clientRectToPdf(
  rect: ClientRect,
  viewport: PdfViewport,
  offset: PageOffset,
): PdfRect | null {
  if (
    ![
      rect.left,
      rect.top,
      rect.right,
      rect.bottom,
      offset.left,
      offset.top,
      offset.cropLeft,
      offset.cropTop,
    ].every(Number.isFinite) ||
    rect.left >= rect.right ||
    rect.top >= rect.bottom
  )
    return null;
  const point = (x: number, y: number) =>
    viewport.convertToPdfPoint(
      x - offset.left + offset.cropLeft,
      y - offset.top + offset.cropTop,
    );
  const points = [
    point(rect.left, rect.top),
    point(rect.right, rect.top),
    point(rect.left, rect.bottom),
    point(rect.right, rect.bottom),
  ];
  if (points.some((p) => p.length !== 2 || !p.every(Number.isFinite)))
    return null;
  const converted: PdfRect = [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
  return validPdfRect(converted) ? converted : null;
}

/** Preserve DOM reading order; merge same-line touching/overlapping boxes. */
export function mergePdfRects(rects: readonly PdfRect[]): PdfRect[] {
  const merged: PdfRect[] = [];
  for (const original of rects) {
    if (!validPdfRect(original)) continue;
    let box: PdfRect = [...original];
    let insertAt = merged.length;
    for (let i = 0; i < merged.length; ) {
      const other = merged[i];
      if (
        Math.abs(box[1] - other[1]) <= 2 &&
        Math.abs(box[3] - other[3]) <= 2 &&
        box[0] <= other[2] + 2 &&
        other[0] <= box[2] + 2
      ) {
        box = [
          Math.min(box[0], other[0]),
          Math.min(box[1], other[1]),
          Math.max(box[2], other[2]),
          Math.max(box[3], other[3]),
        ];
        insertAt = Math.min(insertAt, i);
        merged.splice(i, 1);
        i = 0; // A bridging box may now reach an earlier disjoint fragment.
      } else i++;
    }
    merged.splice(Math.min(insertAt, merged.length), 0, box);
  }
  return merged
    .map((rect) => rect.map(round) as PdfRect)
    .filter(validPdfRect)
    .slice(0, 200);
}

/** CSS page-local drawing coordinates, inverse of clientRectToPdf. */
export function pdfRectToPage(
  rect: PdfRect,
  viewport: PdfViewport,
  crop: { left: number; top: number },
): ClientRect | null {
  if (!validPdfRect(rect) || ![crop.left, crop.top].every(Number.isFinite))
    return null;
  const result = viewport.convertToViewportRectangle(rect);
  if (result.length !== 4 || !result.every(Number.isFinite)) return null;
  return {
    left: Math.min(result[0], result[2]) - crop.left,
    top: Math.min(result[1], result[3]) - crop.top,
    right: Math.max(result[0], result[2]) - crop.left,
    bottom: Math.max(result[1], result[3]) - crop.top,
  };
}

/** DOM selection/search gather geometry and text; this pure part builds storage. */
export function pdfLocatorFromGeometry(input: {
  fileHash: string;
  href: string;
  pageIndex: number;
  pageCount: number;
  viewport: PdfViewport;
  rects: readonly PdfRect[];
  text: { highlight: string; before?: string; after?: string };
  pageLabel?: string;
  tocLabel?: string;
}): DurtalLocator | null {
  if (
    !/^[0-9a-f]{64}$/.test(input.fileHash) ||
    input.href.length > 2048 ||
    !Number.isSafeInteger(input.pageIndex) ||
    !Number.isSafeInteger(input.pageCount) ||
    input.pageIndex < 0 ||
    input.pageIndex >= input.pageCount ||
    !Number.isFinite(input.viewport.height) ||
    input.viewport.height <= 0
  )
    return null;
  const rects = mergePdfRects(input.rects);
  const highlight = input.text.highlight
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10000);
  if (!rects.length || !highlight) return null;
  const first = input.viewport.convertToViewportRectangle(rects[0]);
  if (first.length !== 4 || !first.every(Number.isFinite)) return null;
  const progression = Math.max(
    0,
    Math.min(1, Math.min(first[1], first[3]) / input.viewport.height),
  );
  const before = input.text.before?.replace(/\s+/g, " ").slice(-32);
  const after = input.text.after?.replace(/\s+/g, " ").slice(0, 32);
  return {
    v: 1,
    fileHash: input.fileHash,
    href: input.href,
    sectionIndex: input.pageIndex,
    pdf: { page: input.pageIndex + 1, rects },
    progression,
    totalProgression: (input.pageIndex + progression) / input.pageCount,
    text: {
      highlight,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    },
    pageLabel:
      input.pageLabel?.trim().slice(0, 40) || String(input.pageIndex + 1),
    ...(input.tocLabel?.trim()
      ? { tocLabel: input.tocLabel.trim().slice(0, 300) }
      : {}),
  };
}

/** Original page, two either side, then the rest; no duplicate page work. */
export function* pdfHealingPages(
  pageIndex: number,
  pageCount: number,
): Generator<number> {
  if (
    !Number.isSafeInteger(pageIndex) ||
    !Number.isSafeInteger(pageCount) ||
    pageIndex < 0 ||
    pageCount <= 0
  )
    throw new RangeError("Invalid PDF healing page");
  const local = [
    pageIndex,
    pageIndex - 1,
    pageIndex + 1,
    pageIndex - 2,
    pageIndex + 2,
  ].filter((i) => i >= 0 && i < pageCount);
  yield* local;
  for (let i = 0; i < pageCount; i++) if (!local.includes(i)) yield i;
}
