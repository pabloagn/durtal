import { describe, expect, it } from "vitest";
import { lockPageScroll, type ScrollRoot } from "@/lib/utils/scroll-lock";

function root(style: Partial<ScrollRoot["style"]> = {}): ScrollRoot {
  return { style: { overflow: "", scrollbarGutter: "", ...style } };
}

describe("lockPageScroll", () => {
  it("hides the overflow of the element that scrolls the page and keeps its gutter", () => {
    const html = root();
    lockPageScroll(html);
    expect(html.style).toEqual({ overflow: "hidden", scrollbarGutter: "stable" });
  });

  it("puts back the earlier inline styles when it is released", () => {
    const html = root({ overflow: "auto", scrollbarGutter: "auto" });
    const release = lockPageScroll(html);
    release();
    expect(html.style).toEqual({ overflow: "auto", scrollbarGutter: "auto" });
  });

  it("leaves no inline style behind on an element that had none", () => {
    const html = root();
    lockPageScroll(html)();
    expect(html.style).toEqual({ overflow: "", scrollbarGutter: "" });
  });
});
