// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useCoverMenu } from "@/hooks/use-cover-menu";

let host: HTMLElement, root: Root;
const open = vi.fn();
function Cover({ enabled = true }: { enabled?: boolean }) {
  return createElement("a", { href: "/library/nadja", ...useCoverMenu(enabled, open) }, "Nadja");
}
function pointer(type: string, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerType: { value: "touch" }, isPrimary: { value: true },
    clientX: { value: x }, clientY: { value: y } });
  act(() => { host.firstElementChild!.dispatchEvent(event); });
}
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.useFakeTimers(); open.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => { root.render(createElement(Cover)); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

// Synthetic regression coverage only; native Safari/Chrome/Firefox touch evidence is separate.
describe("cover menu gestures", () => {
  it("opens the existing menu on context click without following the cover link", () => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { host.firstElementChild!.dispatchEvent(event); });
    expect(open).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(true);
  });
  it("suppresses the following navigation after a stationary long press", () => {
    pointer("pointerdown"); act(() => { vi.advanceTimersByTime(550); }); pointer("pointerup");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => { host.firstElementChild!.dispatchEvent(click); });
    expect(open).toHaveBeenCalledOnce(); expect(click.defaultPrevented).toBe(true);
  });
  it.each(["move", "scroll", "up", "cancel"])("cancels long press on %s", (reason) => {
    pointer("pointerdown");
    if (reason === "move") pointer("pointermove", 20, 0);
    else if (reason === "scroll") act(() => { document.dispatchEvent(new Event("scroll")); });
    else pointer(reason === "up" ? "pointerup" : "pointercancel");
    act(() => { vi.advanceTimersByTime(600); });
    expect(open).not.toHaveBeenCalled();
  });
  it("keeps selection mode free of cover menus and cancels a pending gesture", () => {
    pointer("pointerdown");
    act(() => { root.render(createElement(Cover, { enabled: false })); });
    act(() => { vi.advanceTimersByTime(600); });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => { host.firstElementChild!.dispatchEvent(event); });
    expect(open).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
  });
});
