// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

// The design audit skips a decorative mark's icon (an empty state's 24px
// mark), but never a control's icon, even inside a decorative box (SLN-641
// piece 10): marking a box decorative must not hide an oversized button icon.

const audit = readFileSync(join(process.cwd(), "scripts/qa/design-audit.js"), "utf8");
const run = () => (0, eval)(audit) as { iconSizes: [string, number][] };

function icon(size: number) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "lucide");
  svg.setAttribute("stroke-width", "1.5");
  // happy-dom has no layout: the audit reads the size and opacity
  svg.setAttribute("style", "opacity: 1");
  svg.getBoundingClientRect = () => ({ width: size, height: size, top: 0, left: 0, right: size, bottom: size, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return svg;
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("skips the mark of an empty state", () => {
  const mark = document.createElement("div");
  mark.append(icon(24));
  document.body.append(mark);
  expect(run().iconSizes).toEqual([["24px", 1]]);
  mark.setAttribute("data-decorative", "");
  expect(run().iconSizes).toEqual([]);
});

it("counts a control's icon inside a decorative box", () => {
  const mark = document.createElement("div");
  mark.setAttribute("data-decorative", "");
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Upload");
  button.append(icon(24));
  mark.append(button);
  document.body.append(mark);
  expect(run().iconSizes).toEqual([["24px", 1]]);
});

it("skips a placeholder mark inside a card's link", () => {
  const link = document.createElement("a");
  link.href = "/collections/1";
  const mark = document.createElement("span");
  mark.setAttribute("data-decorative", "");
  mark.append(icon(40));
  link.append(mark);
  document.body.append(link);
  expect(run().iconSizes).toEqual([]);
});
