import type { PageViewport } from "pdfjs-dist";
import { describe, expect, it } from "vitest";
import { pdfGeometryViewport } from "@/lib/reader/engines/foliate/pdf-viewport";

describe("pdf.js point-only viewport bridge", () => {
  it.each([0, 90, 180, 270])(
    "uses four actual transformed corners at rotation %i",
    (rotation) => {
      const angle = (rotation * Math.PI) / 180;
      const transform = (x: number, y: number) => [
        Math.round(x * Math.cos(angle) - y * Math.sin(angle)),
        Math.round(x * Math.sin(angle) + y * Math.cos(angle)),
      ];
      const actual = {
        height: 800,
        convertToViewportPoint: transform,
        convertToPdfPoint: (x: number, y: number) => [x, y],
      } as PageViewport;
      const bridge = pdfGeometryViewport(actual);
      const points = [
        [10, 20],
        [30, 20],
        [30, 40],
        [10, 40],
      ].map(([x, y]) => transform(x, y));
      expect(bridge.convertToViewportRectangle([10, 20, 30, 40])).toEqual([
        Math.min(...points.map(([x]) => x)),
        Math.min(...points.map(([, y]) => y)),
        Math.max(...points.map(([x]) => x)),
        Math.max(...points.map(([, y]) => y)),
      ]);
      expect(bridge.convertToPdfPoint(10, 20)).toEqual([10, 20]);
    },
  );
});
