// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { uncollapse } from "@/vendor/foliate-js/paginator.js";

/* SLN-676: a saved place is a point; the paginator anchors it on a glyph */
const point = (text: string, offset: number) => {
  const p = document.createElement("p");
  p.textContent = text;
  document.body.replaceChildren(p);
  const range = document.createRange();
  range.setStart(p.firstChild!, offset);
  range.collapse(true);
  return range;
};

describe("anchoring a saved point", () => {
  it("skips the white space a line wrap leaves at the end of the previous column", () => {
    const anchored = uncollapse(point("city candle  distant. Kept", 11)) as Range;
    expect([anchored.startOffset, anchored.toString()]).toEqual([13, "d"]);
  });
  it("covers the glyph at the point as before", () => {
    const anchored = uncollapse(point("city candle distant", 12)) as Range;
    expect([anchored.startOffset, anchored.toString()]).toEqual([12, "d"]);
  });
  it("keeps the old fallback when no glyph follows in the document", () => {
    const anchored = uncollapse(point("candle  ", 6)) as Range;
    expect([anchored.startOffset, anchored.endOffset]).toEqual([6, 7]);
  });
  it("skips a wrap space that ends its text node to the glyph after it", () => {
    const p = document.createElement("p");
    p.append("city candle ");
    const em = document.createElement("em");
    em.textContent = "distant";
    p.append(em, ". Kept");
    document.body.replaceChildren(p);
    const range = document.createRange();
    range.setStart(p.firstChild!, 11);
    range.collapse(true);
    const anchored = uncollapse(range) as Range;
    expect([anchored.startContainer, anchored.startOffset, anchored.toString()]).toEqual([em.firstChild, 0, "d"]);
  });
  it("anchors a wrap space before an image on the image", () => {
    const p = document.createElement("p");
    p.append("city candle ");
    const img = document.createElement("img");
    p.append(img, "distant");
    document.body.replaceChildren(p);
    const range = document.createRange();
    range.setStart(p.firstChild!, 11);
    range.collapse(true);
    expect(uncollapse(range)).toBe(img);
  });
  it("anchors a point between elements on the element after it", () => {
    const figure = document.createElement("figure");
    document.body.replaceChildren(figure);
    const range = document.createRange();
    range.setStart(document.body, 0);
    range.collapse(true);
    expect(uncollapse(range)).toBe(figure);
  });
});
