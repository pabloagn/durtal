// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { BARS_HIDE_MS, useReaderBars } from "@/components/reader/reader-shell";

/* SLN-663: the bars come on intent, not on a hot strip that blinks */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let bars: ReturnType<typeof useReaderBars>;
function Harness({ held }: { held: boolean }) {
  bars = useReaderBars({ held });
  return null;
}
const render = (held = false) =>
  act(() => root.render(h(Harness, { held })));
beforeEach(() => {
  vi.useFakeTimers();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("the reader's bars", () => {
  it("show on any real mouse movement and hide once it rests", () => {
    render();
    act(() => vi.advanceTimersByTime(BARS_HIDE_MS));
    expect(bars.visible).toBe(false);
    act(() => bars.pointerAt(400, 300));
    act(() => bars.pointerAt(420, 310));
    expect(bars.visible).toBe(true);
    act(() => vi.advanceTimersByTime(BARS_HIDE_MS - 100));
    act(() => bars.pointerAt(500, 320));
    act(() => vi.advanceTimersByTime(BARS_HIDE_MS - 100));
    expect(bars.visible).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(bars.visible).toBe(false);
  });
  it("ignore a still pointer's repeated position after a page turn", () => {
    render();
    act(() => bars.pointerAt(400, 300));
    act(() => vi.advanceTimersByTime(BARS_HIDE_MS));
    expect(bars.visible).toBe(false);
    act(() => bars.pointerAt(400, 300));
    act(() => bars.pointerAt(401, 300));
    expect(bars.visible).toBe(false);
  });
  it("stay up while held, as when pinned, even through a page turn", () => {
    render(true);
    act(() => vi.advanceTimersByTime(BARS_HIDE_MS * 3));
    act(() => bars.hide());
    expect(bars.visible).toBe(true);
  });
});
