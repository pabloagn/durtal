import { describe, expect, it } from "vitest";
import {
  clientRectToPdf,
  mergePdfRects,
  pdfHealingPages,
  pdfLocatorFromGeometry,
  pdfRectToPage,
  validPdfRect,
  type PdfViewport,
  type PdfRect,
} from "@/lib/reader/engines/foliate/pdf-geometry";

const hash = "b".repeat(64);
const plain: PdfViewport = {
  height: 800,
  convertToPdfPoint: (x, y) => [x, 800 - y],
  convertToViewportRectangle: ([x1, y1, x2, y2]) => [
    x1,
    800 - y1,
    x2,
    800 - y2,
  ],
};
const rotated: PdfViewport = {
  height: 600,
  convertToPdfPoint: (x, y) => [y, x],
  convertToViewportRectangle: ([x1, y1, x2, y2]) => [y1, x1, y2, x2],
};
const offset = { left: 10, top: 20, cropLeft: 30, cropTop: 40 };

describe("pure PDF locator geometry", () => {
  it("maps all corners through ordinary and rotated viewports including crop offsets", () => {
    const rect = { left: 20, top: 40, right: 60, bottom: 60 };
    expect(clientRectToPdf(rect, plain, offset)).toEqual([40, 720, 80, 740]);
    expect(clientRectToPdf(rect, rotated, offset)).toEqual([60, 40, 80, 80]);
    for (const viewport of [plain, rotated]) {
      const pdf = clientRectToPdf(rect, viewport, offset)!;
      expect(
        pdfRectToPage(pdf, viewport, {
          left: offset.cropLeft,
          top: offset.cropTop,
        }),
      ).toEqual({ left: 10, top: 20, right: 50, bottom: 40 });
    }
  });

  it("maps 300% selection back to the same stored units and redraws it at 100%", () => {
    const zoomed: PdfViewport = {
      height: 2400,
      convertToPdfPoint: (x, y) => [x / 3, 800 - y / 3],
      convertToViewportRectangle: ([x1, y1, x2, y2]) => [
        x1 * 3,
        (800 - y1) * 3,
        x2 * 3,
        (800 - y2) * 3,
      ],
    };
    const pdf = clientRectToPdf(
      { left: 120, top: 180, right: 240, bottom: 240 },
      zoomed,
      { left: 0, top: 0, cropLeft: 0, cropTop: 0 },
    )!;
    expect(pdf).toEqual([40, 720, 80, 740]);
    expect(pdfRectToPage(pdf, plain, { left: 0, top: 0 })).toEqual({
      left: 40,
      top: 60,
      right: 80,
      bottom: 80,
    });
  });

  it("merges touching lines, handles bridging fragments, rounds and limits storage", () => {
    expect(
      mergePdfRects([
        [20, 100, 30, 110],
        [0, 100, 10, 110],
        [11, 101, 19, 111],
        [0.1234, 50.567, 10.333, 60.234],
      ]),
    ).toEqual([
      [0, 100, 30, 111],
      [0.12, 50.57, 10.33, 60.23],
    ]);
    expect(
      mergePdfRects(
        Array.from(
          { length: 201 },
          (_, i): PdfRect => [0, i * 20, 10, i * 20 + 10],
        ),
      ),
    ).toHaveLength(200);
    expect(mergePdfRects([[0, 0, 0.001, 0.001]])).toEqual([]);
  });

  it("refuses nonfinite, inverted and degenerate rectangles", () => {
    expect(validPdfRect([0, 0, NaN, 10])).toBe(false);
    expect(validPdfRect([10, 0, 0, 10])).toBe(false);
    expect(validPdfRect([0, 0, 10, 10])).toBe(true);
    expect(
      clientRectToPdf({ left: 0, top: 0, right: 0, bottom: 10 }, plain, offset),
    ).toBeNull();
    expect(
      pdfRectToPage([10, 0, 0, 10], plain, { left: 0, top: 0 }),
    ).toBeNull();
  });

  const context = {
    fileHash: hash,
    href: "1",
    pageIndex: 1,
    pageCount: 500,
    viewport: plain,
    rects: [[40, 720, 80, 740]] as PdfRect[],
    text: {
      highlight: "  Alpha\n beta\tword ",
      before: "b".repeat(40),
      after: "a".repeat(40),
    },
    pageLabel: " ii ",
  };
  it("stores a one-based page, quote/context, physical progression and no CFI", () => {
    const locator = pdfLocatorFromGeometry(context)!;
    expect(locator).toMatchObject({
      fileHash: hash,
      href: "1",
      sectionIndex: 1,
      pdf: { page: 2, rects: [[40, 720, 80, 740]] },
      progression: 60 / 800,
      totalProgression: (1 + 60 / 800) / 500,
      pageLabel: "ii",
      text: {
        highlight: "Alpha beta word",
        before: "b".repeat(32),
        after: "a".repeat(32),
      },
    });
    expect(locator).not.toHaveProperty("cfi");
    expect(
      pdfLocatorFromGeometry({ ...context, pageLabel: undefined })!.pageLabel,
    ).toBe("2");
  });

  it("uses display top after rotation and limits all stored text labels", () => {
    const locator = pdfLocatorFromGeometry({
      ...context,
      viewport: rotated,
      rects: [[60, 40, 80, 80]],
      text: { highlight: "x".repeat(10001) },
      pageLabel: "i".repeat(50),
      tocLabel: "a".repeat(301),
    })!;
    expect(locator.progression).toBe(60 / 600);
    expect(locator.text!.highlight).toHaveLength(10000);
    expect(locator.pageLabel).toHaveLength(40);
    expect(locator.tocLabel).toHaveLength(300);
    expect(pdfLocatorFromGeometry({ ...context, pageIndex: -1 })).toBeNull();
    expect(pdfLocatorFromGeometry({ ...context, rects: [] })).toBeNull();
    expect(
      pdfLocatorFromGeometry({ ...context, fileHash: "invalid" }),
    ).toBeNull();
  });

  it("heals locally first and visits the whole remaining document without duplicates", () => {
    expect([...pdfHealingPages(3, 8)]).toEqual([3, 2, 4, 1, 5, 0, 6, 7]);
    expect([...pdfHealingPages(0, 3)]).toEqual([0, 1, 2]);
    expect([...pdfHealingPages(50, 3)]).toEqual([0, 1, 2]);
    expect(() => [...pdfHealingPages(-1, 3)]).toThrow(RangeError);
  });
});
