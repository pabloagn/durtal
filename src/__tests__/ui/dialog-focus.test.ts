// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // happy-dom has no layout. Hidden descendants still have no client rects.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.closest("[hidden]") ? [] : [new DOMRect(0, 0, 44, 44)]) as unknown as DOMRectList;
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function render() {
  act(() => root.render(createElement(Dialog, {
    open: true, onClose: () => {}, title: "Delete work", expandable: false,
    children: createElement("div", null,
      createElement("button", { id: "cancel" }, "Cancel"),
      createElement("button", { id: "delete" }, "Delete"),
      createElement("button", { disabled: true }, "Disabled"),
      createElement("div", { hidden: true }, createElement("button", null, "Hidden")),
    ),
  })));
  return {
    dialog: host.querySelector("dialog")!,
    first: host.querySelector<HTMLButtonElement>('[aria-label="Close Delete work"]')!,
    last: host.querySelector<HTMLButtonElement>("#delete")!,
    cancel: host.querySelector<HTMLButtonElement>("#cancel")!,
  };
}
function tab(target: HTMLElement, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
  act(() => { target.focus(); target.dispatchEvent(event); });
  return event;
}
describe("modal keyboard cycle", () => {
  it("wraps after the last enabled visible control", () => {
    const { first, last } = render();
    expect(tab(last).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });
  it("wraps backwards before the first control", () => {
    const { first, last } = render();
    expect(tab(first, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });
  it("enters at the correct end when the dialog itself has focus", () => {
    const { dialog, first, last } = render();
    tab(dialog); expect(document.activeElement).toBe(first);
    tab(dialog, true); expect(document.activeElement).toBe(last);
  });
  it("leaves ordinary Tab movement between controls to the browser", () => {
    const { cancel } = render();
    expect(tab(cancel).defaultPrevented).toBe(false);
  });
});
