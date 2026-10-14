// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PageEdges } from "@/components/reader/page-edges";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

const shown = (label: string) => {
  const button = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  return !button.inert && !button.className.includes("opacity-0");
};
const render = (visible: boolean, hovered: "left" | "right" | null, dir: "ltr" | "rtl" = "ltr") =>
  act(() => root.render(h(PageEdges, { visible, hovered, dir, onLeft() {}, onRight() {} })));

describe("the page turn buttons (SLN-662)", () => {
  it("show both with the bars", () => {
    render(true, null);
    expect([shown("Previous page"), shown("Next page")]).toEqual([true, true]);
  });
  it("keep only the hovered margin's button up once the bars hide", () => {
    render(false, "right");
    expect([shown("Previous page"), shown("Next page")]).toEqual([false, true]);
    render(false, null);
    expect([shown("Previous page"), shown("Next page")]).toEqual([false, false]);
  });
  it("follow the book's direction", () => {
    render(false, "left", "rtl");
    expect([shown("Next page"), shown("Previous page")]).toEqual([true, false]);
  });
});
