// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-632: N opens the New menu; A is only a prefix, A then a key adds at
// once, and anything else after A does nothing.

const nav = vi.hoisted(() => ({ pathname: "/library", push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn(), prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/notifications/toast", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/app/(catalogue)/people/author-create-dialog", () => ({
  AuthorCreateDialog: () => createElement("div", { id: "add-person" }),
}));
vi.mock("@/app/(catalogue)/places/venue-create-dialog", () => ({ VenueCreateDialog: () => null }));
vi.mock("@/components/collections/create-collection-dialog", () => ({ CreateCollectionDialog: () => null }));
vi.mock("@/components/recommenders/recommender-form-dialog", () => ({ RecommenderFormDialog: () => null }));
vi.mock("@/components/organizations/organization-dialog", () => ({ OrganizationDialog: () => createElement("div", { id: "add-organization" }) }));
vi.mock("@/components/series/series-form-dialog", () => ({ SeriesFormDialog: () => null }));
vi.mock("@/components/shortcuts/shortcuts-help", () => ({ ShortcutsHelp: () => null }));

import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { ADD, SHORTCUTS, SHORTCUT_GROUPS } from "@/lib/shortcuts/shortcuts";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
let now = 0;
beforeEach(() => {
  nav.pathname = "/library";
  nav.push.mockClear();
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function render(...children: Parameters<typeof createElement>[2][]) {
  act(() =>
    root.render(
      createElement(ShortcutsProvider, {
        paletteOpen: false,
        onPaletteOpenChange: () => {},
        children: createElement(Fragment, null, ...children),
      }),
    ),
  );
}
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
const menu = () => document.querySelector('[role="menu"]');

describe("N and A (SLN-632)", () => {
  it("opens the New menu with N, and nothing with A", () => {
    press("a");
    expect(menu()).toBeNull();
    // N right after A is A's second key: it adds nothing and opens nothing
    press("n");
    expect(menu()).toBeNull();
    press("n");
    expect(menu()?.getAttribute("aria-label")).toBe("New");
    expect(menu()?.textContent).toContain("Perfume");
  });

  it("adds a book, a perfume, a person and a publisher with A then B, P, A and U", () => {
    press("a");
    press("b");
    press("a");
    press("p");
    press("a");
    press("u");
    expect(nav.push.mock.calls.map((c) => c[0])).toEqual(["/library/new", "/perfumes/new", "/publishers/new"]);
    press("a");
    press("a");
    expect(document.getElementById("add-person")).not.toBeNull();
  });

  it("opens an organization with A O and from the N menu", () => {
    press("a"); press("o");
    expect(document.getElementById("add-organization")).not.toBeNull();
    expect(ADD.find(a => a.key === "o")).toMatchObject({ label: "Organization", dialog: "organization" });
  });

  it("does nothing after A for Esc, an unknown key, Shift or a modifier", () => {
    for (const [second, init] of [
      ["Escape", {}],
      ["x", {}],
      ["B", { shiftKey: true }],
      ["b", { metaKey: true }],
      ["b", { ctrlKey: true }],
    ] as const) {
      press("a");
      press(second, init);
      press("b");
    }
    expect(nav.push).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it("lets a key that comes too late after A act on its own", () => {
    press("a");
    now += 1600;
    press("b");
    expect(nav.push).not.toHaveBeenCalled();
    press("a");
    now += 1600;
    press("g");
    expect(menu()?.getAttribute("aria-label")).toBe("Go to");
  });

  it("waits through Shift alone, and never starts while typing or on a held A", () => {
    press("a");
    press("Shift", { shiftKey: true });
    press("b");
    expect(nav.push).toHaveBeenCalledTimes(1);

    render(createElement("input", { id: "field" }));
    const field = document.getElementById("field")!;
    press("a", {}, field);
    press("b");
    press("a", { repeat: true });
    press("b");
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it("drops a pending A when the page changes", () => {
    press("a");
    nav.pathname = "/people";
    render();
    press("b");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("lists the same keys in the sheet, the menu and the registry", () => {
    expect(SHORTCUTS.newMenu).toEqual(["n"]);
    expect(WORK_DOMAINS.perfume.keys.add).toBe("p");
    const keys = ADD.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.fromEntries(ADD.map((a) => [a.key, a.label]))).toMatchObject({
      b: "Book",
      p: "Perfume",
      a: "Person",
      u: "Publisher",
    });
    const sheet = SHORTCUT_GROUPS.find((g) => g.title === "Add")!;
    expect(sheet.items.map((i) => i.keys.join(" "))).toEqual(keys.map((k) => `a ${k}`));
    expect(SHORTCUT_GROUPS.find((g) => g.title === "Menus")!.items.some((i) => i.keys.join() === "n")).toBe(true);
  });
});
