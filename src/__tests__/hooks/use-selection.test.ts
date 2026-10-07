// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSelection, type Selection } from "@/lib/hooks/use-selection";

// Escape and the selection mode (SLN-531): one layer per Esc

let selection: Selection;
function List() {
  selection = useSelection();
  return null;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(List)));
  act(() => {
    selection.enterSelectionMode();
    selection.selectAll(["a", "b"]);
  });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
const escape = (on: Element, prevent = false) =>
  act(() => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    // A menu marks its Escape handled in its own listener on the document
    if (prevent) document.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    on.dispatchEvent(event);
  });

describe("useSelection and Escape", () => {
  it("leaves selection mode and clears the choice when nothing is open", () => {
    escape(document.body);
    expect(selection.isSelecting).toBe(false);
    expect(selection.selectionCount).toBe(0);
  });

  it("keeps the selection while a dialog is open: the dialog takes the Escape", () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const field = document.createElement("button");
    dialog.append(field);
    document.body.append(dialog);
    escape(field);
    expect(selection.isSelecting).toBe(true);
    expect(selection.selectionCount).toBe(2);
    // The dialog closed: the next Escape is the list's
    dialog.remove();
    escape(document.body);
    expect(selection.isSelecting).toBe(false);
  });

  it("keeps the selection when a menu has handled the Escape", () => {
    escape(document.body, true);
    expect(selection.isSelecting).toBe(true);
    expect(selection.selectionCount).toBe(2);
  });
});
