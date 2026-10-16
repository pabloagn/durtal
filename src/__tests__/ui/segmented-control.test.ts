// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SegmentedControl } from "@/components/ui/segmented-control";

let root: Root | null = null;
let host: HTMLElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

const render = (fill: boolean) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(SegmentedControl, {
    ariaLabel: "Show", value: "a", onChange: () => {}, fill,
    options: [{ value: "a", label: "Highlights" }, { value: "b", label: "Notes" }, { value: "c", label: "Bookmarks" }],
  })));
  return host.querySelector<HTMLElement>("[role=radiogroup]")!;
};

describe("SegmentedControl fill", () => {
  it("keeps equal columns, but never narrower than a label (Bookmarks at 320 on touch)", () => {
    const group = render(true);
    // minmax(0, 1fr) let a long label overrun its button's border
    expect(group.className).toContain("auto-cols-[minmax(max-content,1fr)]");
    expect(group.className).not.toContain("auto-cols-fr");
  });

  it("leaves the default row as it was", () => {
    expect(render(false).className).toBe("flex flex-wrap gap-1 pointer-coarse:gap-2");
  });
});
