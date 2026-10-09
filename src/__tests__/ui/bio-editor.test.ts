// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  act,
  createElement,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { RichTextEditor } from "@/components/shared/rich-text-editor";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
let changeValue: Dispatch<SetStateAction<string>>;
const changes: string[] = [];
function Harness() {
  const [value, setValue] = useState("<p>Existing biography</p>");
  changeValue = setValue;
  return createElement(RichTextEditor, {
    label: "Biography",
    value,
    onChange: (html: string) => {
      changes.push(html);
      setValue(html);
    },
  });
}
function mount() {
  changes.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  return host.querySelector<HTMLDivElement>('[contenteditable="true"]')!;
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
});

describe("biography editor", () => {
  it("keeps the browser's text node and selection when an input updates React", () => {
    const editor = mount();
    editor.textContent = "Fresh biography";
    const node = editor.firstChild!;
    const range = document.createRange();
    range.setStart(node, 5);
    range.setEnd(node, 5);
    window.getSelection()!.addRange(range);
    act(() => editor.dispatchEvent(new Event("input", { bubbles: true })));
    expect(changes).toEqual(["Fresh biography"]);
    expect(editor.firstChild).toBe(node);
    expect(window.getSelection()!.anchorNode).toBe(node);
    expect(window.getSelection()!.anchorOffset).toBe(5);
  });

  it("loads external content and clears it on reset without reporting an edit", () => {
    const editor = mount();
    expect(editor.innerHTML).toBe("<p>Existing biography</p>");
    expect(editor.getAttribute("aria-label")).toBe("Biography");
    act(() => changeValue("<p>Another person</p>"));
    expect(editor.innerHTML).toBe("<p>Another person</p>");
    act(() => changeValue(""));
    expect(editor.innerHTML).toBe("");
    expect(changes).toEqual([]);
  });
});
