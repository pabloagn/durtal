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
// The hook decides once the key has reached every listener: the next task
const escape = (on: Element, prevent = false) =>
  act(async () => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    // A menu marks its Escape handled in its own listener on the document
    if (prevent) document.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    on.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve));
  });

describe("useSelection and Escape", () => {
  it("leaves selection mode and clears the choice when nothing is open", async () => {
    await escape(document.body);
    expect(selection.isSelecting).toBe(false);
    expect(selection.selectionCount).toBe(0);
  });

  it("keeps the selection while a dialog is open: the dialog takes the Escape", async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const field = document.createElement("button");
    dialog.append(field);
    document.body.append(dialog);
    await escape(field);
    expect(selection.isSelecting).toBe(true);
    expect(selection.selectionCount).toBe(2);
    // The dialog closed: the next Escape is the list's
    dialog.remove();
    await escape(document.body);
    expect(selection.isSelecting).toBe(false);
  });

  it("keeps the selection when a menu has handled the Escape", async () => {
    await escape(document.body, true);
    expect(selection.isSelecting).toBe(true);
    expect(selection.selectionCount).toBe(2);
  });

  it("keeps the selection when a window listener added after the list's takes the Escape, as the command palette does", async () => {
    // The palette's listener is added again each time it opens, so it comes after the list's
    const palette = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", palette);
    await escape(document.body);
    window.removeEventListener("keydown", palette);
    expect(selection.isSelecting).toBe(true);
    expect(selection.selectionCount).toBe(2);
    await escape(document.body);
    expect(selection.isSelecting).toBe(false);
  });
});
