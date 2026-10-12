// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OutsideTapBackdrop } from "@/components/reader/outside-tap-backdrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});
const layer = () => document.querySelector("[data-reader-menu-backdrop]");

it("closes on touch down and stays until that tap's click, so nothing beneath is pressed", () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let open = true;
  const onClose = vi.fn(() => {
    open = false;
    render();
  });
  const render = () => root!.render(h(OutsideTapBackdrop, { kind: "menu", open, onClose }));
  act(render);
  act(() => layer()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(layer()).not.toBeNull();
  act(() => layer()!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(layer()).toBeNull();
});

it("lets go after a drag that brings no click", () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(h(OutsideTapBackdrop, { kind: "menu", open: true, onClose: () => {} })));
  act(() => layer()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  act(() => root!.render(h(OutsideTapBackdrop, { kind: "menu", open: false, onClose: () => {} })));
  expect(layer()).not.toBeNull();
  act(() => vi.advanceTimersByTime(700));
  expect(layer()).toBeNull();
});
