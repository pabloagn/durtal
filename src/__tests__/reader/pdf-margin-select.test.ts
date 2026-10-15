// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { attachMarginSelect, textPointNear } from "@/lib/reader/engines/foliate/pdf-margin-select";

/** A text layer with two lines, each one span at x 100..400 */
function layer() {
  document.body.innerHTML = `<div class="textLayer"><span>The first line of text</span><span>The second line here</span></div>`;
  const container = document.querySelector(".textLayer")!;
  const spans = [...container.querySelectorAll("span")];
  spans.forEach((span, i) => {
    const top = 100 + i * 20;
    span.getBoundingClientRect = () => ({ left: 100, right: 400, top, bottom: top + 14, width: 300, height: 14, x: 100, y: top, toJSON() {} }) as DOMRect;
  });
  return { container, spans };
}

const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: "mouse", button: 0, pointerId: 1, ...extra });

describe("PDF drag beside a line", () => {
  it("finds the start of the line a point to its left sits on", () => {
    const { container, spans } = layer();
    const point = textPointNear(container, 80, 127, 64);
    expect(point?.node).toBe(spans[1].firstChild);
    expect(point?.offset).toBe(0);
  });

  it("finds the end of the line for a point to its right, and nothing too far off or between lines", () => {
    const { container, spans } = layer();
    const point = textPointNear(container, 430, 105, 64);
    expect(point?.node).toBe(spans[0].firstChild);
    expect(point?.offset).toBe(spans[0].textContent!.length);
    expect(textPointNear(container, 20, 105, 64)).toBeNull();
    expect(textPointNear(container, 80, 117, 64)).toBeNull();
  });

  it("selects from the line's start when a mouse drag starts in the margin", () => {
    const { container, spans } = layer();
    document.elementFromPoint = () => container;
    attachMarginSelect(document);
    container.dispatchEvent(pointer("pointerdown", 80, 107));
    container.dispatchEvent(pointer("pointermove", 450, 107));
    container.dispatchEvent(pointer("pointerup", 450, 107));
    const selection = document.getSelection()!;
    expect(selection.anchorNode).toBe(spans[0].firstChild);
    expect(selection.anchorOffset).toBe(0);
    expect(selection.focusNode).toBe(spans[0].firstChild);
    expect(selection.focusOffset).toBe(spans[0].textContent!.length);
  });

  it("leaves a drag that starts on text, a touch and a Shift-click to the browser", () => {
    const { container, spans } = layer();
    attachMarginSelect(document);
    document.getSelection()!.removeAllRanges();
    document.elementFromPoint = () => spans[0];
    container.dispatchEvent(pointer("pointerdown", 150, 107));
    container.dispatchEvent(pointer("pointermove", 450, 107));
    expect(document.getSelection()!.rangeCount).toBe(0);
    document.elementFromPoint = () => container;
    container.dispatchEvent(pointer("pointerdown", 80, 107, { pointerType: "touch" }));
    container.dispatchEvent(pointer("pointermove", 450, 107, { pointerType: "touch" }));
    expect(document.getSelection()!.rangeCount).toBe(0);
    container.dispatchEvent(pointer("pointerdown", 80, 107, { shiftKey: true }));
    container.dispatchEvent(pointer("pointermove", 450, 107));
    expect(document.getSelection()!.rangeCount).toBe(0);
  });
});
