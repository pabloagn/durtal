// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipLayer } from "@/components/ui/tooltip";

// SLN-1150: touch has no hover, so an icon-only control (Mark as rare, a
// view button) could not say what it does before it acted. A long-press now
// shows its tooltip, and the lift does not press it. Synthetic events; the
// real touches were checked in Chromium, Firefox and WebKit.

let root: Root;
let host: HTMLElement;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const tooltip = () => document.getElementById("app-tooltip");
const shown = () => (tooltip()?.hasAttribute("data-open") ? tooltip()!.textContent : null);

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const matches = Element.prototype.matches;
  Element.prototype.matches = function (selector: string) {
    if (selector === ":popover-open") return this.hasAttribute("data-open");
    return matches.call(this, selector);
  };
  HTMLElement.prototype.showPopover = function () {
    this.setAttribute("data-open", "");
  };
  HTMLElement.prototype.hidePopover = function () {
    this.removeAttribute("data-open");
  };
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(TooltipLayer)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("[data-probe]").forEach((el) => el.remove());
});

function control(label: string) {
  const button = document.createElement("button");
  button.dataset.probe = "";
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  document.body.append(button);
  return button;
}
function pointer(el: Element, type: string, x = 10, y = 10) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerType: { value: "touch" }, isPrimary: { value: true }, clientX: { value: x }, clientY: { value: y } });
  act(() => void el.dispatchEvent(event));
}
function lift(el: Element) {
  pointer(el, "pointerup");
  const end = new Event("touchend", { bubbles: true, cancelable: true });
  act(() => void el.dispatchEvent(end));
  pointer(el, "pointerout");
  return end;
}

describe("a long-press on touch", () => {
  it("shows the control's tooltip, keeps it after the lift, and presses nothing", async () => {
    const rare = control("Mark as rare");
    pointer(rare, "pointerdown");
    await wait(550);
    expect(shown()).toBe("Mark as rare");
    const end = lift(rare);
    // A cancelled touchend: the browser sends no click
    expect(end.defaultPrevented).toBe(true);
    expect(shown()).toBe("Mark as rare");
    await wait(1600);
    expect(shown()).toBeNull();
  });

  it("leaves a tap alone, and a finger that moves away", async () => {
    const grid = control("Grid");
    pointer(grid, "pointerdown");
    await wait(100);
    const end = lift(grid);
    expect(end.defaultPrevented).toBe(false);
    await wait(500);
    expect(shown()).toBeNull();

    pointer(grid, "pointerdown");
    pointer(grid, "pointermove", 40, 10);
    await wait(600);
    expect(shown()).toBeNull();
  });

  it("keeps the system's own long-press menu off it", async () => {
    const list = control("List");
    pointer(list, "pointerdown");
    await wait(550);
    const menu = new Event("contextmenu", { bubbles: true, cancelable: true });
    act(() => void list.dispatchEvent(menu));
    expect(menu.defaultPrevented).toBe(true);
    lift(list);
  });
});
