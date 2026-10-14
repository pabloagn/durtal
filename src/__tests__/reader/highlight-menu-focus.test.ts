// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HighlightMenu } from "@/components/reader/highlight-menu";
import type { ReaderAnnotation } from "@/lib/reader/annotations";

let root: Root, host: HTMLElement, shadowHost: HTMLElement, mark: HTMLElement;
const annotation = { id: "a1", kind: "highlight", style: "highlight", color: "ochre", text: "A passage", note: null } as unknown as ReaderAnnotation;
const rect = { left: 100, top: 100, right: 200, bottom: 120 };
/** The reader's view: a frame in a shadow root, with focus on a mark in the book */
function focusMark(fromKeyboard: boolean) {
  shadowHost = document.createElement("div"); document.body.append(shadowHost);
  const frame = document.createElement("iframe");
  shadowHost.attachShadow({ mode: "open" }).append(frame);
  const doc = frame.contentDocument!;
  mark = doc.createElement("span"); mark.tabIndex = 0; doc.body.append(mark);
  frame.focus(); mark.focus();
  vi.spyOn(mark, "matches").mockImplementation((selector) => selector === ":focus-visible" && fromKeyboard);
}
const open = (onClose = vi.fn()) => {
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  act(() => root.render(h(HighlightMenu, { annotation, rect, onClose, onEdit: vi.fn(), onNote: vi.fn(), onDelete: vi.fn() })));
  const first = host.querySelector("button")!;
  const call = focus.mock.calls[focus.mock.instances.indexOf(first)];
  focus.mockRestore();
  return { first, options: call?.[0] as (FocusOptions & { focusVisible?: boolean }) | undefined, onClose };
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); shadowHost?.remove(); vi.restoreAllMocks(); });

describe("a mark's actions after a click on it (SLN-670 review)", () => {
  it("focuses the first swatch without a visible focus, so its tooltip cannot take the first Esc", () => {
    focusMark(false);
    const { first, options } = open();
    expect(document.activeElement && host.contains(document.activeElement)).toBe(true);
    expect(first.getAttribute("aria-label")).toBe("Highlight in ochre");
    expect(options).toMatchObject({ preventScroll: true, focusVisible: false });
  });
  it("keeps the focus visible when the mark was opened from the keyboard", () => {
    focusMark(true);
    expect(open().options).toMatchObject({ focusVisible: true });
  });
  it("puts focus back on the mark on Esc", () => {
    focusMark(false);
    const { first, onClose } = open();
    const focused = vi.spyOn(mark, "focus");
    act(() => { first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(onClose).toHaveBeenCalledOnce();
    expect(focused).toHaveBeenCalledWith({ preventScroll: true });
  });
  it("puts focus back on the mark on Close", () => {
    focusMark(false);
    const { onClose } = open();
    const focused = vi.spyOn(mark, "focus");
    act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Close")!.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(focused).toHaveBeenCalledWith({ preventScroll: true });
  });
});
