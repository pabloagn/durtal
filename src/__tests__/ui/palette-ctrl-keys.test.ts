// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The shortcuts survey (16 Oct): on Windows and Linux a second Ctrl+K moved the
// palette's selection up instead of closing it, because cmdk's vim bindings
// took Ctrl+J/K/N/P and the shortcut handler skips a key already taken. They
// also kept the browser's Ctrl+N and Ctrl+P (SLN-962).
const mocks = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/quick-search", () => ({ quickSearch: async () => null, getPaletteContinueReading: async () => null }));
vi.mock("@/lib/actions/reading", () => ({ getOpenReadings: async () => [] }));
vi.mock("@/components/shortcuts/shortcuts-provider", () => ({
  useShortcutActions: () => ({ editItems: () => [], readingItems: () => [], copyItems: () => [], itemKeys: () => [] }),
}));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({}) }));
vi.mock("@/components/reading/timer-provider", () => ({ useOptionalTimer: () => null }));
vi.mock("@/components/reading/timer-chip", () => ({ useStopTimer: () => () => {} }));

import { CommandPalette } from "@/components/layout/command-palette";

let host: HTMLElement, root: Root;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(async () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => {
    root.render(createElement(CommandPalette, { open: true, onOpenChange: mocks.close, recentEbook: null }));
  });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const selected = () => host.querySelector("[cmdk-item][data-selected=true]")?.textContent;
function press(key: string, init: KeyboardEventInit = {}) {
  const input = host.querySelector<HTMLInputElement>("input")!;
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => { input.dispatchEvent(event); });
  return event;
}

describe("Ctrl keys in the palette", () => {
  it.each(["k", "j", "n", "p"])("leaves Ctrl+%s to the shortcuts and the browser", (key) => {
    const before = selected();
    expect(before).toBeTruthy();
    const event = press(key, { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(selected()).toBe(before);
  });

  it("still moves through the list with the arrow keys", () => {
    const first = selected();
    press("ArrowDown");
    expect(selected()).not.toBe(first);
  });
});
