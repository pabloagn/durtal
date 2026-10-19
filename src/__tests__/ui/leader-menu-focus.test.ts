// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-963: a leader menu was silent to a screen reader, as the focus stayed
// on the page, and Tab did nothing while one was open.

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/notifications/toast", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/app/(catalogue)/people/author-create-dialog", () => ({ AuthorCreateDialog: () => null }));
vi.mock("@/app/(catalogue)/places/venue-create-dialog", () => ({ VenueCreateDialog: () => null }));
vi.mock("@/components/collections/create-collection-dialog", () => ({ CreateCollectionDialog: () => null }));
vi.mock("@/components/recommenders/recommender-form-dialog", () => ({ RecommenderFormDialog: () => null }));
vi.mock("@/components/organizations/organization-dialog", () => ({ OrganizationDialog: () => null }));
vi.mock("@/components/series/series-form-dialog", () => ({ SeriesFormDialog: () => null }));
vi.mock("@/components/shortcuts/shortcuts-help", () => ({ ShortcutsHelp: () => null }));

import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(ShortcutsProvider, {
        paletteOpen: false,
        onPaletteOpenChange: () => {},
        children: createElement("button", { id: "before" }, "A control on the page"),
      }),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}
const menu = () => document.querySelector('[role="menu"]');
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const focused = () => document.activeElement as HTMLElement;

describe("a leader menu", () => {
  it("takes the focus on its first item, the only one Tab reaches", () => {
    press("g");
    expect(menu()).not.toBeNull();
    expect(focused()).toBe(items()[0]);
    expect(items().filter((item) => item.tabIndex === 0)).toEqual([items()[0]]);
  });

  it("moves the focus with the arrows, Home and End", () => {
    press("g");
    press("ArrowDown");
    expect(focused()).toBe(items()[1]);
    expect(focused().dataset.active).toBe("true");
    press("ArrowUp");
    press("ArrowUp");
    expect(focused()).toBe(items().at(-1));
    press("Home");
    expect(focused()).toBe(items()[0]);
    press("End");
    expect(focused()).toBe(items().at(-1));
  });

  it("moves with Tab and Shift+Tab, and keeps the menu open", () => {
    press("g");
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(focused()).toBe(items()[1]);
    press("Tab", { shiftKey: true });
    press("Tab", { shiftKey: true });
    expect(focused()).toBe(items().at(-1));
    expect(menu()).not.toBeNull();
  });

  it("gives the focus back to where it was when Escape closes it", () => {
    act(() => document.getElementById("before")!.focus());
    press("g");
    expect(menu()!.contains(focused())).toBe(true);
    press("Escape");
    expect(menu()).toBeNull();
    expect(focused().id).toBe("before");
  });

  it("leaves the page unfocused, as it was, when nothing had the focus", () => {
    press("g");
    press("Escape");
    expect(focused()).toBe(document.body);
  });

  // SLN-1189: opened under a pointer at rest, the menu started on the item
  // under it, so G then Enter could go to Paintings
  it("starts on its first item under a resting pointer, and follows a moving one", () => {
    press("g");
    const at = (x: number, y: number) =>
      act(() => {
        const under = items()[3];
        under.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
        under.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: x, clientY: y }));
        under.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
      });
    // What a browser reports for a pointer the menu appeared under
    at(720, 400);
    expect(focused()).toBe(items()[0]);
    at(720, 400);
    expect(focused()).toBe(items()[0]);
    press("Enter");
    expect(menu()).toBeNull();
    // A pointer that moves picks the item it is over
    press("g");
    at(720, 400);
    at(724, 402);
    expect(focused()).toBe(items()[3]);
    expect(items()[3].dataset.active).toBe("true");
  });
});
