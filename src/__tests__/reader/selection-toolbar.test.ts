// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useLayoutEffect } from "react";
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
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { ReaderSelection } from "@/lib/reader/events";
import { place } from "./fixtures/places";
let root: Root, host: HTMLElement;
const clear = vi.fn();
let native: ReaderSelection | null = null;
function Capture({ bridge }: { bridge: ReaderBridgeController }) {
  useLayoutEffect(() => bridge.registerSelectionCapture(() => native ? { selection: native, clear } : null), [bridge]);
  return null;
}
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
const render = (
  selection: EngineEvents["selection"],
  speech?: { ready: boolean; start: () => void },
  covered = false,
  insets: { topInset?: number; bottomInset?: number } = {},
) => {
  native = selection ? { text: selection.text, locator: selection.locator, fileId: "epub", chapter: null, percent: 44 } : null;
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
            id: "less-used",
            node: h(ReaderSlotFill, { slot: "selection-more" }, h("button", { type: "button" }, "Save quote")),
          },
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
          h("div", null, h(Capture, { bridge }), h(SelectionToolbar, {
            selection,
            bridge,
            onClear: clear,
            speechReady: speech?.ready,
            onReadAloud: speech?.start,
            covered,
            ...insets,
          })),
      }),
    ),
  );
};
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
    ).toEqual(["Copy", "Save quote", "Quote"]);
  });
  it("on touch is one row with More holding Copy, Read aloud and the less used actions, and steps aside under Look up (SLN-678)", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)", media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList);
    render(selected, { ready: true, start: () => {} });
    const toolbar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
    expect(toolbar.dataset.docked).toBe("true");
    const more = host.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;
    const row = more.parentElement!;
    expect([...row.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Quote", ""]);
    const extra = toolbar.lastElementChild as HTMLElement;
    expect(extra.hidden).toBe(true);
    expect([...extra.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Copy", "Read aloud from here", "Save quote"]);
    act(() => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(extra.hidden).toBe(false);
    render(selected, { ready: true, start: () => {} }, true);
    expect(toolbar.hidden).toBe(true);
  });
  it("docks at the top for a selection near the bottom, below the top bar while it shows (SLN-678)", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)", media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList);
    const low = { ...selected, rect: { ...selected.rect, top: innerHeight - 140, bottom: innerHeight - 110 } };
    render(low, undefined, false, { topInset: 57, bottomInset: 93 });
    const toolbar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
    expect(toolbar.style.top).toBe("calc(max(57px, env(safe-area-inset-top)) + 12px)");
    expect(toolbar.style.bottom).toBe("");
    render(selected, undefined, false, { topInset: 57, bottomInset: 0 });
    expect(toolbar.style.top).toBe("");
    expect(toolbar.style.bottom).toBe("calc(max(0px, env(safe-area-inset-bottom)) + 12px)");
  });
  it("keeps selection speech disabled until prepared, then invokes the trusted button handler", () => {
    const start = vi.fn();
    render(selected, { ready: false, start });
    const button = () =>
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Read aloud from here"]',
      )!;
    expect(button().disabled).toBe(true);
    act(() => button().click());
    expect(start).not.toHaveBeenCalled();
    render(selected, { ready: true, start });
    act(() => button().click());
    expect(start).toHaveBeenCalledOnce();
    expect(
      [...host.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Copy", "Read aloud from here", "Save quote", "Quote"]);
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
  it("copies the action-time paragraph while the displayed selection remains the previous word", async () => {
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render({ ...selected, text: "Table" });
    native = { ...native!, text: "Table by the door, where the widow waited.",
      locator: { ...selected.locator, cfi: "epubcfi(paragraph)" } };
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Copy selected text"]')!.click(); });
    expect(copy).toHaveBeenCalledExactlyOnceWith(native.text);
  });
  it("does not copy a stale displayed word after the native selection has collapsed", async () => {
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render({ ...selected, text: "Table" });
    native = null;
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Copy selected text"]')!.click(); });
    expect(copy).not.toHaveBeenCalled();
  });
});
