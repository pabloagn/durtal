// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-477 review: however the command palette closes, focus goes back to
// what had it when the palette opened. The palette's field takes focus as it
// mounts, so the shell reads the opener before the palette renders.

const provider = vi.hoisted(() => ({ change: (_open: boolean) => {} }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }), Toaster: () => null }));
vi.mock("@/components/layout/sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/layout/mobile-nav-bar", () => ({ MobileNavBar: () => null }));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({
  ReadingDialogsProvider: ({ children }: { children: unknown }) => children,
}));
// The reading timer is not under test
vi.mock("@/components/reading/timer-provider", () => ({
  TimerProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/reading/timer-chip", () => ({ TimerAlerts: () => null }));
// The provider hands the shell's palette switch to the test
vi.mock("@/components/shortcuts/shortcuts-provider", () => ({
  ShortcutsProvider: ({ children, onPaletteOpenChange }: { children: unknown; onPaletteOpenChange: (open: boolean) => void }) => {
    provider.change = onPaletteOpenChange;
    return children;
  },
}));
// A palette whose field takes focus as it mounts, as cmdk's does
vi.mock("@/components/layout/command-palette", () => ({
  CommandPalette: ({ open }: { open: boolean }) =>
    open ? createElement("input", { "aria-label": "Palette", autoFocus: true }) : null,
}));

import { Shell } from "@/components/layout/shell";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frame = () => act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));

describe("the command palette gives focus back", () => {
  it("to the control that had it when the palette opened", async () => {
    act(() => root.render(createElement(Shell, null, createElement("button", { type: "button" }, "Sort by title"))));
    const opener = [...host.querySelectorAll("button")].find((b) => b.textContent === "Sort by title")!;
    opener.focus();
    act(() => provider.change(true));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Palette");
    act(() => provider.change(false));
    await frame();
    expect(document.activeElement).toBe(opener);
  });

  it("but not when a pick moved focus on, into a dialog", async () => {
    act(() => root.render(createElement(Shell, null, createElement("button", { type: "button" }, "Sort by title"))));
    const opener = [...host.querySelectorAll("button")].find((b) => b.textContent === "Sort by title")!;
    opener.focus();
    act(() => provider.change(true));
    const dialogField = document.createElement("input");
    document.body.append(dialogField);
    act(() => provider.change(false));
    dialogField.focus();
    await frame();
    expect(document.activeElement).toBe(dialogField);
    dialogField.remove();
  });
});
