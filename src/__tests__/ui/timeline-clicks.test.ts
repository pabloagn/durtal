// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTimelineTransform, type TimelineTransform } from "@/components/timeline/use-timeline-transform";

// SLN-413. The canvas took the pointer on every press, to pan, and Chrome then
// sent the click to the canvas: a book marker or an author bar never opened.
// The canvas takes the pointer only once a press moves (a drag), and the click
// that ends a drag opens nothing.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom has no pointer capture: record it
  HTMLElement.prototype.setPointerCapture = function (id: number) {
    this.setAttribute("data-capture", String(id));
  };
  HTMLElement.prototype.releasePointerCapture = function () {
    this.removeAttribute("data-capture");
  };
  HTMLElement.prototype.hasPointerCapture = function (id: number) {
    return this.getAttribute("data-capture") === String(id);
  };
});

let root: Root;
let host: HTMLElement;
let transform: TimelineTransform;
const opened = vi.fn();
const zoomed = vi.fn();

function Canvas() {
  const timeline = useTimelineTransform();
  transform = timeline.transform;
  return createElement(
    "div",
    { id: "canvas", ...timeline.handlers },
    createElement("div", { id: "marker", role: "button", onClick: opened }, "A book"),
    createElement("button", { id: "zoom", type: "button", onClick: zoomed }, "+"),
    createElement("div", { id: "minimap", role: "scrollbar", onClick: zoomed }),
  );
}

beforeEach(() => {
  opened.mockClear();
  zoomed.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Canvas)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const $ = (id: string) => document.getElementById(id)!;
// The main button is held from pointerdown until pointerup, unless `buttons` says otherwise
const pointer = (target: Element, type: string, x: number, buttons = type === "pointerup" ? 0 : 1) =>
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons, clientX: x, clientY: 10 }),
    );
  });
const click = (target: Element) =>
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
const frame = () => act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));

describe("timeline clicks", () => {
  it("a click on a marker opens it: the canvas does not take the pointer", () => {
    pointer($("marker"), "pointerdown", 10);
    pointer($("marker"), "pointermove", 12);
    expect($("canvas").hasAttribute("data-capture")).toBe(false);
    pointer($("marker"), "pointerup", 12);
    click($("marker"));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("a drag pans, and a drag that ends on a marker opens nothing", async () => {
    pointer($("marker"), "pointerdown", 10);
    pointer($("marker"), "pointermove", 60);
    expect($("canvas").getAttribute("data-capture")).toBe("1");
    await frame();
    expect(transform.offsetX).toBe(50);
    pointer($("marker"), "pointerup", 60);
    expect($("canvas").hasAttribute("data-capture")).toBe(false);
    click($("marker"));
    expect(opened).not.toHaveBeenCalled();
    // Only that one click: the next one opens the marker again
    pointer($("marker"), "pointerdown", 60);
    pointer($("marker"), "pointerup", 60);
    click($("marker"));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("leaves presses on the zoom buttons and the minimap to them", () => {
    for (const id of ["zoom", "minimap"]) {
      pointer($(id), "pointerdown", 10);
      pointer($(id), "pointermove", 60);
      expect($("canvas").hasAttribute("data-capture")).toBe(false);
      pointer($(id), "pointerup", 60);
      click($(id));
    }
    expect(zoomed).toHaveBeenCalledTimes(2);
    expect(transform.offsetX).toBe(0);
  });

  it("a press released outside the canvas ends: a hover after it does not pan", async () => {
    pointer($("marker"), "pointerdown", 10);
    pointer($("marker"), "pointermove", 12);
    // The button comes up outside the canvas, so the canvas never sees it
    pointer(document.body, "pointerup", 400);
    pointer($("marker"), "pointermove", 100, 0);
    await frame();
    expect(transform.offsetX).toBe(0);
    expect($("canvas").hasAttribute("data-capture")).toBe(false);
    click($("marker"));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("a drag cut short by the browser does not swallow the next click", () => {
    pointer($("marker"), "pointerdown", 10);
    pointer($("marker"), "pointermove", 60);
    pointer($("marker"), "pointercancel", 60);
    click($("marker"));
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
