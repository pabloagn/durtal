// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepSelectionOnScreen, rangeOnScreen } from "@/lib/reader/selection-edge";

// Two text nodes laid out one character per 10px. The screen ends at 200px:
// what lies past it is the next page, still in the same frame.
const first = "The widow waited by ", second = "the door until the lamp went out.";
let host: HTMLParagraphElement;
const onScreen = (rect: DOMRect) => rect.left < 200;
/** A box for a one-character range: its place in the paragraph's text, 10px a character */
function box(this: Range) {
  if (this.collapsed) return [] as unknown as DOMRectList;
  const node = this.startContainer as Text;
  const index = (node === host.lastChild?.firstChild ? first.length : 0) + this.startOffset;
  // White space before "until" has no box, as collapsed white space does
  if ((node.data[this.startOffset] ?? "") === " " && index === first.length + 8) return [] as unknown as DOMRectList;
  return [new DOMRect(index * 10, 0, 10, 20)] as unknown as DOMRectList;
}

beforeEach(() => {
  host = document.createElement("p");
  host.append(first);
  const span = document.createElement("em");
  span.append(second);
  host.append(span);
  document.body.append(host);
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(box);
});
afterEach(() => {
  vi.restoreAllMocks();
  host.remove();
  document.getSelection()?.removeAllRanges();
});

const range = (from: [Node, number], to: [Node, number]) => {
  const r = document.createRange();
  r.setStart(...from);
  r.setEnd(...to);
  return r;
};

describe("a selection stops at the screen's edge (SLN-682)", () => {
  it("keeps a selection that shows in full", () => {
    expect(rangeOnScreen(range([host.firstChild!, 4], [host.firstChild!, 10]), onScreen)).toBeNull();
  });

  it("drops what a drag selected on the next page", () => {
    const text = host.lastChild!.firstChild!;
    const kept = rangeOnScreen(range([host.firstChild!, 4], [text, second.length]), onScreen)!;
    // 200px is the 20th character: "the door" is past it
    expect(kept.toString()).toBe("widow waited by ");
  });

  it("drops what a drag back selected on the page before", () => {
    const text = host.lastChild!.firstChild!;
    // The screen is 200px to 400px wide here
    const shows = (rect: DOMRect) => rect.left >= 200 && rect.left < 400;
    const kept = rangeOnScreen(range([host.firstChild!, 0], [text, 12]), shows)!;
    expect(kept.toString()).toBe("the door unt");
  });

  it("holds the anchor where the reader started", () => {
    const text = host.lastChild!.firstChild!;
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(text, second.length, host.firstChild!, 4);
    expect(keepSelectionOnScreen(document, (rect) => rect.left >= 40 && rect.left < 600)).toBe(false);
    selection.setBaseAndExtent(host.firstChild!, 4, text, second.length);
    expect(keepSelectionOnScreen(document, onScreen)).toBe(true);
    expect(selection.toString()).toBe("widow waited by ");
    expect(selection.anchorNode).toBe(host.firstChild);
    expect(selection.anchorOffset).toBe(4);
  });
});
