// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ReaderBridgeProvider,
  ReaderSlotFill,
} from "@/components/reader/bridge";
import {
  SelectionToolbar,
  selectionToolbarPosition,
} from "@/components/reader/selection-toolbar";
import type { EngineEvents } from "@/lib/reader/engine";
import { place } from "./fixtures/places";
let root: Root, host: HTMLElement;
const clear = vi.fn();
const selected: NonNullable<EngineEvents["selection"]> = {
  text: "A selected passage",
  locator: place().locator,
  rect: { left: 30, right: 300, top: 200, bottom: 230 },
  keyboard: true,
};
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  clear.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const render = (selection: EngineEvents["selection"]) =>
  act(() =>
    root.render(
      h(ReaderBridgeProvider, {
        context: {
          ebookId: "book",
          fileId: "epub",
          format: "epub",
          locator: null,
          chapter: null,
          percent: null,
          selection: null,
        },
        plugins: [
          {
            id: "extra",
            node: h(
              ReaderSlotFill,
              { slot: "selection-actions" },
              h(
                "button",
                {
                  "aria-label": "Plugin action",
                  "data-tooltip": "Plugin action",
                },
                "Quote",
              ),
            ),
          },
        ],
        children: (bridge) =>
          h(SelectionToolbar, { selection, bridge, onClear: clear }),
      }),
    ),
  );
describe("selection toolbar", () => {
  it("stays hidden without a settled selection and places plugin buttons after Copy", () => {
    render(null);
    expect(host.querySelector<HTMLElement>('[role="toolbar"]')!.hidden).toBe(
      true,
    );
    render(selected);
    expect(host.querySelector<HTMLElement>('[role="toolbar"]')!.hidden).toBe(
      false,
    );
    expect(
      [...host.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Copy", "Quote"]);
  });
  it("copies through Clipboard API, holds Copied for two seconds and clears on Escape", async () => {
    vi.useFakeTimers();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(selected);
    await act(async () => {
      host.querySelector("button")!.click();
    });
    expect(copy).toHaveBeenCalledWith(selected.text);
    expect(host.querySelector("button")!.textContent).toBe("Copied");
    act(() => vi.advanceTimersByTime(1999));
    expect(host.querySelector("button")!.textContent).toBe("Copied");
    act(() => vi.advanceTimersByTime(1));
    expect(host.querySelector("button")!.textContent).toBe("Copy");
    act(() => {
      host
        .querySelector("button")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(clear).toHaveBeenCalledOnce();
  });
  it("keeps the toolbar inside 16px insets, flips below and always uses below on iOS", () => {
    const size = { width: 150, height: 44 },
      viewport = { width: 390, height: 844 };
    expect(
      selectionToolbarPosition(selected.rect, size, viewport, false),
    ).toEqual({ left: 90, top: 148 });
    expect(
      selectionToolbarPosition(
        { ...selected.rect, top: 20, bottom: 40 },
        size,
        viewport,
        false,
      ).top,
    ).toBe(48);
    expect(
      selectionToolbarPosition(selected.rect, size, viewport, true).top,
    ).toBe(238);
    expect(
      selectionToolbarPosition(
        { left: 380, right: 390, top: 830, bottom: 844 },
        size,
        viewport,
        true,
      ),
    ).toEqual({ left: 224, top: 784 });
  });
});
