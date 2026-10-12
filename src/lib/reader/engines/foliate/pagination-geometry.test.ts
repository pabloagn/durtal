// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { getPaginatedAnchorPage, getPaginatedSectionProgress } from "@/vendor/foliate-js/paginator.js";
import { SectionProgress } from "@/vendor/foliate-js/progress.js";

describe("section columns sharing a spread", () => {
  it("lands at the measured final visible spread without another forward turn", () => {
    // Native Chromium: seven prior columns, then66 columns in the final
    // linear section. The browser clamps a full-spread target at46647px.
    const size = 1314, columnCount = 2, offset = 4599, contentPages = 66;
    const finalPage = getPaginatedAnchorPage({ offset, size, columnCount, contentPages, fraction: 1 });
    const totalExtent = offset + contentPages * size / columnCount;
    const actualScroll = Math.min(finalPage * size, totalExtent - size);
    expect(finalPage).toBe(36);
    expect(actualScroll).toBe(46647);
    expect(actualScroll + size).toBe(totalExtent);
    // The old floored-offset sum targeted45990 and left657px unread.
    expect(actualScroll).not.toBe(45990);
    const progress = getPaginatedSectionProgress({ start: actualScroll - offset, size, columnCount, contentPages });
    expect(progress.fraction).toBeCloseTo(64 / 66);
    expect(progress.fraction + progress.size).toBeCloseTo(1);
  });
  it.each([1, 2, 3])("preserves both endpoints and every occupied column with%d columns", columnCount => {
    const size = 1200;
    for (let priorColumns = 0; priorColumns < 8; priorColumns++) {
      for (let contentPages = 1; contentPages < 12; contentPages++) {
        const offset = priorColumns * size / columnCount;
        const first = getPaginatedAnchorPage({ offset, size, columnCount, contentPages, fraction: 0 });
        const last = getPaginatedAnchorPage({ offset, size, columnCount, contentPages, fraction: 1 });
        const finalColumnStart = offset + (contentPages - 1) * size / columnCount;
        expect(first * size).toBeLessThanOrEqual(offset);
        expect((first + 1) * size).toBeGreaterThan(offset);
        expect(last * size).toBeLessThanOrEqual(finalColumnStart);
        expect((last + 1) * size).toBeGreaterThan(finalColumnStart);
        for (let column = 0; column < contentPages; column++) {
          const fraction = contentPages === 1 ? 0 : column / (contentPages - 1);
          const page = getPaginatedAnchorPage({ offset, size, columnCount, contentPages, fraction });
          const point = offset + column * size / columnCount;
          expect(page * size).toBeLessThanOrEqual(point);
          expect((page + 1) * size).toBeGreaterThan(point);
        }
      }
    }
  });
  it("absorbs the same subpixel drift as existing container rect navigation", () => {
    expect(getPaginatedAnchorPage({ offset: 4598.9999, size: 1314, columnCount: 2, contentPages: 66, fraction: 1 })).toBe(36);
    expect(getPaginatedSectionProgress({ start: -657, size: 1314, columnCount: 2, contentPages: 66 }).fraction).toBe(0);
  });
});

describe("partial-spread public progress", () => {
  it("bounds the final visible spread without giving nonlinear notes a share", () => {
    const book = new SectionProgress([{ size: 6000 }, { size: 9000 }, { size: 2000, linear: "no" }], 1500, 1600);
    expect(book.getProgress(1, 64 / 66, 2 / 66).fraction).toBe(1);
    expect(book.getProgress(1, 1, 2 / 66).fraction).toBe(1);
    expect(book.getProgress(1, 0.5, 0).fraction).toBe(0.7);
    expect(book.getProgress(0, 0, 0).fraction).toBe(0);
    expect(book.getProgress(2, 0, 0).fraction).toBe(1);
    expect(book.getSection(1)).toEqual([2, 1]);
  });
  it("publishes finite progress for a book with no measured text", () => {
    expect(new SectionProgress([{ size: 0 }], 1500, 1600).getProgress(0, 0, 0).fraction).toBe(0);
  });
});
