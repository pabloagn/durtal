// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { PdfDecorations } from "@/lib/reader/engines/foliate/pdf-decorations";
import type { FoliateBook, FoliateView } from "@/lib/reader/engines/foliate/foliate";
import type { Decoration } from "@/lib/reader/engine";
const hash = "a".repeat(64);
describe("PDF overlay ownership (DOM contract, not native geometry certification)", () => {
  it("projects stored rectangles with the adopted viewport/crop and preserves independent groups", () => {
    const doc = document.implementation.createHTMLDocument();
    let contents = [{ doc, index: 0 }];
    const view = { renderer: { getContents: () => contents } } as unknown as FoliateView;
    const book = { pdfViewport: () => ({ height: 100, convertToPdfPoint: (x: number, y: number) => [x, y], convertToViewportRectangle: (r: number[]) => r.map(n => n * 2) }), pdfCropOffset: () => ({ left: 4, top: 6 }) } as unknown as FoliateBook;
    const marks = new PdfDecorations(() => {});
    const item: Decoration = { id: "a", locator: { v: 1, fileHash: hash, href: "0", sectionIndex: 0, progression: 0, totalProgression: 0, pdf: { page: 1, rects: [[10, 20, 30, 40]] } }, style: "highlight", color: "#abc" };
    marks.set("annotations", [item]); marks.set("search", [{ ...item, id: "s", style: "outline" }]);
    marks.render(view, book, hash, { link: "#abc" });
    expect(doc.querySelector("rect")?.getAttribute("x")).toBe("16");
    expect(doc.querySelector("rect")?.getAttribute("y")).toBe("34");
    marks.set("search", []); marks.render(view, book, hash, { link: "#abc" });
    expect(doc.querySelectorAll("[data-decoration-id]")).toHaveLength(1);
    contents = []; marks.render(view, book, hash, { link: "#abc" });
    expect(doc.querySelector("[data-durtal-pdf-marks]")).toBeNull();
    marks.destroy();
  });
  it("lets a selection start on a mark, and opens it on a plain click (SLN-670)", () => {
    const doc = document.implementation.createHTMLDocument();
    const view = { renderer: { getContents: () => [{ doc, index: 0 }] } } as unknown as FoliateView;
    const book = { pdfViewport: () => ({ height: 100, convertToPdfPoint: (x: number, y: number) => [x, y], convertToViewportRectangle: (r: number[]) => r }), pdfCropOffset: () => ({ left: 0, top: 0 }) } as unknown as FoliateBook;
    const opened: string[] = [];
    const marks = new PdfDecorations((event) => opened.push(event.decorationId));
    const item: Decoration = { id: "a", locator: { v: 1, fileHash: hash, href: "0", sectionIndex: 0, progression: 0, totalProgression: 0, pdf: { page: 1, rects: [[10, 20, 30, 40]] } }, style: "highlight", color: "#abc" };
    marks.set("annotations", [item]); marks.render(view, book, hash, { link: "#abc" });
    const mark = doc.querySelector<SVGGElement>("[data-decoration-id]")!;
    expect(mark.style.pointerEvents).toBe("none");
    doc.querySelector("rect")!.getBoundingClientRect = () => new DOMRect(10, 20, 20, 20);
    const click = (x: number, y: number) => { const event = new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }); doc.body.dispatchEvent(event); return event; };
    expect(click(50, 50).defaultPrevented).toBe(false);
    expect(click(15, 30).defaultPrevented).toBe(true);
    expect(opened).toEqual(["a"]);
    marks.destroy();
    click(15, 30);
    expect(opened).toEqual(["a"]);
  });
  it("does not draw before a real viewport has been adopted", () => {
    const doc = document.implementation.createHTMLDocument();
    const marks = new PdfDecorations(() => {});
    marks.render({ renderer: { getContents: () => [{ doc, index: 0 }] } } as unknown as FoliateView, { pdfViewport: () => null } as unknown as FoliateBook, hash, { link: "#abc" });
    expect(doc.querySelector("[data-durtal-pdf-marks]")).toBeNull();
  });
});
