// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The alignment audit skips a blank cover's book icon, which centres in its
// own box, but not an icon beside text, however it is marked: marking an icon
// `data-decorative` must not hide a slip from its text (SLN-641)

const audit = readFileSync(join(process.cwd(), "scripts/qa/alignment-audit.js"), "utf8");
const run = () => (0, eval)(audit) as { checked: number; issues: unknown[] };

// happy-dom has no layout: each element's box comes from its data-box
// ("left,top,width,height"); the line's text sits at 0-20 with its cap
// centre at 9.5 (a 15px baseline, an 11px cap height)
function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect;
}
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const box = this.getAttribute("data-box");
    if (!box) return rect(0, 15, 0, 0);
    const [l, t, w, h] = box.split(",").map(Number);
    return rect(l, t, w, h);
  });
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(() => [rect(40, 0, 8, 20)] as unknown as DOMRectList);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ font: "", measureText: () => ({ actualBoundingBoxAscent: 11 }) }) as never,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** A 16px icon 5px below the text's cap centre (its centre at 14.5 against 9.5) */
const ICON = `<svg class="lucide" data-box="16,6.5,16,16"></svg>`;

it("checks an icon in a button, marked decorative, beside the button's label", () => {
  document.body.innerHTML = `<button style="display:flex" data-box="0,0,160,20">${ICON.replace("<svg", "<svg data-decorative")}Order this book</button>`;
  expect(run().issues).toHaveLength(1);
});

it("checks an icon marked decorative beside the text of its row", () => {
  document.body.innerHTML = `<p style="display:flex" data-box="0,0,200,20">${ICON.replace("<svg", "<svg data-decorative")}Wanted from Gallimard</p>`;
  expect(run().issues).toHaveLength(1);
});

it("skips a blank cover's icon, centred alone in its box beside a title", () => {
  document.body.innerHTML = `<div style="display:flex" data-box="0,0,300,48"><span style="display:flex" data-box="0,0,32,48"><svg class="lucide" data-decorative data-box="8,16,16,16"></svg></span><a href="#" data-box="44,0,200,20">A title on its first line</a></div>`;
  const { checked, issues } = run();
  expect(issues).toHaveLength(0);
  expect(checked).toBe(0);
});
