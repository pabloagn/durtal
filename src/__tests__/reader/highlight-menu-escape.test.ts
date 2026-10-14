// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HighlightMenu } from "@/components/reader/highlight-menu";
import { createReaderInput } from "@/lib/reader/input";
import { hasOpenSurface } from "@/lib/ui/surface-state";
import type { ReaderAnnotation } from "@/lib/reader/annotations";

let root: Root, host: HTMLElement;
const annotation = { id: "a1", kind: "highlight", style: "highlight", color: "ochre", text: "A passage", note: null } as unknown as ReaderAnnotation;
const rect = { left: 100, top: 100, right: 200, bottom: 120 };
const escape = (target: EventTarget) => {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("a mark's actions close on Esc from anywhere (SLN-670)", () => {
  const render = (onClose: () => void) => act(() => root.render(h(HighlightMenu, {
    annotation, rect, onClose, onEdit: vi.fn(), onNote: vi.fn(), onDelete: vi.fn(),
  })));
  it("closes when focus stayed outside the menu, as after the click on the mark", () => {
    const onClose = vi.fn();
    render(onClose);
    expect(hasOpenSurface()).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(escape(document.body).defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("closes on Esc in the book's document, through the reader's input layer", () => {
    const onClose = vi.fn();
    render(onClose);
    const frame = document.implementation.createHTMLDocument("book");
    const actions = { escape: vi.fn() } as unknown as Parameters<typeof createReaderInput>[0]["actions"];
    const input = createReaderInput({ actions, isBlocked: () => hasOpenSurface() });
    input.attach(frame);
    escape(frame.body);
    expect(onClose).toHaveBeenCalledOnce();
    expect(actions.escape).not.toHaveBeenCalled();
    input.destroy();
  });
  it("lets go of Esc once it is closed", () => {
    render(vi.fn());
    act(() => root.render(h("div")));
    expect(hasOpenSurface()).toBe(false);
  });
});
