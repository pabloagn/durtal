import { describe, expect, it } from "vitest";
import {
  pdfLocatorFromTextOffsets,
  pdfRectsForTextOffsets,
  type PdfPageTextGeometry,
} from "@/lib/reader/engines/foliate/pdf-text-geometry";

// Synthetic measured-cluster input: W is wider than i; "fi" is a ligature.
const geometry: PdfPageTextGeometry = {
  text: "Wi fi\nnext",
  clusters: [
    { start: 0, end: 1, quad: [10, 700, 22, 700, 22, 712, 10, 712] },
    { start: 1, end: 2, quad: [22, 700, 25, 700, 25, 712, 22, 712] },
    { start: 3, end: 5, quad: [30, 700, 37, 700, 37, 712, 30, 712] },
    { start: 6, end: 7, quad: [10, 680, 18, 680, 18, 692, 10, 692] },
    { start: 7, end: 8, quad: [18, 680, 25, 680, 25, 692, 18, 692] },
    { start: 8, end: 9, quad: [25, 680, 32, 680, 32, 692, 25, 692] },
    { start: 9, end: 10, quad: [32, 680, 38, 680, 38, 692, 32, 692] },
  ],
  separators: [
    { start: 2, end: 3 },
    { start: 5, end: 6 },
  ],
};
const context = {
  fileHash: "b".repeat(64),
  href: "1",
  pageIndex: 1,
  pageCount: 20,
  viewport: {
    height: 800,
    convertToPdfPoint: (x: number, y: number) => [x, 800 - y],
    convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [
      x1,
      800 - y1,
      x2,
      800 - y2,
    ],
  },
};

describe("detached PDF offset geometry", () => {
  it("preserves supplied proportional glyph widths and ligature clusters", () => {
    expect(pdfRectsForTextOffsets(geometry, 0, 1)).toEqual([
      [10, 700, 22, 712],
    ]);
    expect(pdfRectsForTextOffsets(geometry, 1, 2)).toEqual([
      [22, 700, 25, 712],
    ]);
    expect(pdfRectsForTextOffsets(geometry, 4, 5)).toEqual([
      [30, 700, 37, 712],
    ]);
  });

  it("builds the same PDF locator without a mounted document or DOMRects", () => {
    const locator = pdfLocatorFromTextOffsets(geometry, 0, 5, context)!;
    expect(locator.pdf).toEqual({
      page: 2,
      rects: [
        [10, 700, 25, 712],
        [30, 700, 37, 712],
      ],
    });
    expect(locator.text).toEqual({ highlight: "Wi fi", after: " next" });
    expect(locator.pageLabel).toBe("2");
    expect(locator.cfi).toBeUndefined();
    expect(pdfRectsForTextOffsets(geometry, 0, 10)).toHaveLength(3);
  });

  it("refuses partial or absent measured coverage instead of inventing rectangles", () => {
    expect(
      pdfRectsForTextOffsets(
        { ...geometry, clusters: geometry.clusters.slice(1) },
        0,
        2,
      ),
    ).toBeNull();
    expect(
      pdfRectsForTextOffsets({ ...geometry, clusters: [] }, 0, 5),
    ).toBeNull();
    expect(
      pdfLocatorFromTextOffsets({ ...geometry, clusters: [] }, 0, 5, context),
    ).toBeNull();
    expect(pdfRectsForTextOffsets(geometry, 2, 3)).toBeNull();
    expect(pdfRectsForTextOffsets(geometry, 0, 0)).toBeNull();
    expect(pdfRectsForTextOffsets(geometry, 0, 20)).toBeNull();
    expect(
      pdfRectsForTextOffsets(
        {
          text: "A",
          separators: [],
          clusters: [
            {
              start: 0,
              end: 1,
              quad: [0, 0, 0.001, 0, 0.001, 0.001, 0, 0.001],
            },
          ],
        },
        0,
        1,
      ),
    ).toBeNull();
  });

  it("does not permit fake separators to hide missing nonwhitespace geometry", () => {
    expect(
      pdfRectsForTextOffsets(
        { ...geometry, separators: [{ start: 0, end: 2 }] },
        0,
        5,
      ),
    ).toBeNull();
    expect(
      pdfRectsForTextOffsets(
        {
          ...geometry,
          clusters: [{ start: 0, end: 1, quad: [NaN, 0, 1, 0, 1, 1, 0, 1] }],
        },
        0,
        1,
      ),
    ).toBeNull();
  });

  it("normalizes rotated measured quads without relying on connected DOM layout", () => {
    const rotated: PdfPageTextGeometry = {
      text: "A",
      separators: [],
      clusters: [{ start: 0, end: 1, quad: [50, 70, 50, 82, 38, 82, 38, 70] }],
    };
    expect(pdfRectsForTextOffsets(rotated, 0, 1)).toEqual([[38, 70, 50, 82]]);
  });
});
