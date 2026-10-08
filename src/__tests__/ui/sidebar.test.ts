// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Sidebar } from "@/components/layout/sidebar";
import { useSidebarPreference } from "@/lib/hooks/use-sidebar-preference";
import { SIDEBAR, sidebarExpandedWidth, sidebarWidth } from "@/lib/preferences";
import { clearPreferences } from "@/lib/hooks/use-preference";
import { readCookie, writeCookie } from "@/lib/utils/preference-cookies";

vi.mock("next/navigation", () => ({ usePathname: () => "/library" }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/components/reading/timer-chip", () => ({ TimerChip: () => null }));

let compact = false;
const listeners = new Set<() => void>();
let preference: ReturnType<typeof useSidebarPreference>;
function Harness({ drawer = false }: { drawer?: boolean }) {
  preference = useSidebarPreference();
  return createElement(Sidebar, {
    width: preference.width,
    onWidthChange: preference.setWidth,
    onToggle: preference.toggle,
    onCommandPalette: () => {},
    drawer,
    drawerOpen: drawer,
    onDrawerClose: () => {},
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (() => ({
    matches: compact,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  })) as unknown as typeof window.matchMedia;
});
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  compact = false;
  clearPreferences([SIDEBAR.key, SIDEBAR.expandedKey, SIDEBAR.compactKey]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = () => act(() => root.render(createElement(Harness)));
const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-controls="app-sidebar"]')!;
const changeCompact = (next: boolean) => act(() => {
  compact = next;
  listeners.forEach((fn) => fn());
});

describe("sidebar choices", () => {
  it("retains the focused toggle, navigation nodes, and scroll offset", () => {
    render();
    const button = toggle();
    const nav = host.querySelector("nav")!;
    const links = [...nav.querySelectorAll("a")];
    nav.scrollTop = 240;
    button.focus();
    for (let i = 0; i < 4; i++) {
      act(() => button.click());
      const collapsed = i % 2 === 0;
      expect(button.getAttribute("aria-label")).toBe(collapsed ? "Expand navigation" : "Collapse navigation");
      expect(button.getAttribute("aria-expanded")).toBe(String(!collapsed));
      expect(document.activeElement).toBe(button);
      expect(host.querySelector("nav")).toBe(nav);
      expect([...nav.querySelectorAll("a")]).toEqual(links);
      expect(nav.scrollTop).toBe(240);
      expect(links.find((a) => a.getAttribute("aria-current") === "page")?.getAttribute("href")).toBe("/library");
    }
  });

  it("restores a custom expanded width through toggle, double-click and remount", () => {
    writeCookie(SIDEBAR.key, "312"); // A legacy cookie with no remembered-width cookie
    render();
    act(() => toggle().click());
    expect(preference.width).toBe(56);
    expect(readCookie(SIDEBAR.expandedKey)).toBe("312");
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(preference.width).toBe(56);
    const handle = host.querySelector("aside > div:last-child")!;
    act(() => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(preference.width).toBe(312);
    act(() => preference.setWidth(280));
    act(() => preference.setWidth(56)); // Dragging into the snap zone
    act(() => toggle().click());
    expect(preference.width).toBe(280);
  });

  it("allows tablet expansion and preserves desktop state across breakpoints", () => {
    writeCookie(SIDEBAR.key, "300");
    render();
    changeCompact(true);
    expect(preference.width).toBe(56);
    act(() => toggle().click());
    expect(preference.width).toBe(300);
    expect(readCookie(SIDEBAR.compactKey)).toBe("true");
    act(() => toggle().click());
    expect(preference.width).toBe(56);
    expect(readCookie(SIDEBAR.key)).toBe("300");
    changeCompact(false);
    expect(preference.width).toBe(300);
    changeCompact(true);
    act(() => toggle().click());
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(preference.width).toBe(300);
  });

  it("can expand on a tablet when the desktop preference is collapsed", () => {
    writeCookie(SIDEBAR.key, "56");
    writeCookie(SIDEBAR.expandedKey, "264");
    compact = true;
    render();
    act(() => toggle().click());
    expect(preference.width).toBe(264);
    changeCompact(false);
    expect(preference.width).toBe(56);
  });

  it("resets all sidebar choices with display preferences", () => {
    render();
    act(() => preference.setWidth(330));
    act(() => toggle().click());
    act(() => clearPreferences([SIDEBAR.key, SIDEBAR.expandedKey, SIDEBAR.compactKey]));
    expect(preference.width).toBe(224);
  });

  it("keeps the drawer close control when the desktop preference is collapsed", () => {
    writeCookie(SIDEBAR.key, "56");
    act(() => root.render(createElement(Harness, { drawer: true })));
    expect(host.querySelector('button[aria-label="Close navigation"]')).not.toBeNull();
    expect(host.querySelector('a[href="/library"]')?.textContent).toBe("Books");
  });

  it("rejects corrupt widths and never restores the rail as an expanded width", () => {
    for (const width of [undefined, null, "300", 0, 119, 361, NaN, Infinity, -Infinity]) {
      expect(sidebarWidth(width)).toBe(224);
      expect(sidebarExpandedWidth(width)).toBe(224);
    }
    expect(sidebarExpandedWidth(56)).toBe(224);
    expect(sidebarExpandedWidth(120)).toBe(120);
    expect(sidebarExpandedWidth(360)).toBe(360);
  });
});
