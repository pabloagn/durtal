import type { PageViewport } from "pdfjs-dist";
import type { PdfViewport } from "./pdf-geometry";

/** pdf.js 6.4 exports point conversion only; normalize all four rect corners. */
export function pdfGeometryViewport(viewport: PageViewport): PdfViewport {
  return {
    height: viewport.height,
    convertToPdfPoint: (x, y) => viewport.convertToPdfPoint(x, y),
    convertToViewportRectangle: ([x0, y0, x1, y1]) => {
      const points = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ].map(([x, y]) => viewport.convertToViewportPoint(x, y));
      if (
        points.some(
          (point) => point.length !== 2 || !point.every(Number.isFinite),
        )
      )
        return [NaN, NaN, NaN, NaN];
      return [
        Math.min(...points.map((point) => point[0])),
        Math.min(...points.map((point) => point[1])),
        Math.max(...points.map((point) => point[0])),
        Math.max(...points.map((point) => point[1])),
      ];
    },
  };
}
