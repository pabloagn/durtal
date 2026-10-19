// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-571: on an item's page, A then F favourites it and A then C opens its
// collections; elsewhere they add a film and create a collection.

const nav = vi.hoisted(() => {
  const push = vi.fn();
  // One router, as Next gives: a new one each render would re-register every shortcut
  return { pathname: "/library/dune", push, router: { push, replace: () => {}, refresh: () => {}, prefetch: () => {} } };
});
const favourites = vi.hoisted(() => ({ setFavourite: vi.fn(async () => {}) }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/notifications/toast", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/actions/favourites", () => favourites);
vi.mock("@/app/(catalogue)/people/author-create-dialog", () => ({ AuthorCreateDialog: () => null }));
vi.mock("@/app/(catalogue)/places/venue-create-dialog", () => ({ VenueCreateDialog: () => null }));
vi.mock("@/components/collections/create-collection-dialog", () => ({
  CreateCollectionDialog: () => createElement("div", { id: "create-collection" }),
}));
vi.mock("@/components/recommenders/recommender-form-dialog", () => ({ RecommenderFormDialog: () => null }));
vi.mock("@/components/series/series-form-dialog", () => ({ SeriesFormDialog: () => null }));
vi.mock("@/components/shortcuts/shortcuts-help", () => ({ ShortcutsHelp: () => null }));

import { ShortcutsProvider, useShortcutActions } from "@/components/shortcuts/shortcuts-provider";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { CollectionShortcut } from "@/components/books/add-to-collection-dialog";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts/shortcuts";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
const openCollections = vi.fn();
let itemKeys: () => string[] = () => [];
function Probe() {
  itemKeys = useShortcutActions().itemKeys;
  return null;
}
beforeEach(() => {
  nav.push.mockClear();
  favourites.setFavourite.mockClear();
  openCollections.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(...children: Parameters<typeof createElement>[2][]) {
  act(() =>
    root.render(
      createElement(ShortcutsProvider, {
        paletteOpen: false,
        onPaletteOpenChange: () => {},
        children: createElement(Fragment, null, createElement(Probe), ...children),
      }),
    ),
  );
}
function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}
const itemPage = () =>
  render(
    createElement(FavouriteToggle, { favourite: false, target: { entity: "work", id: "w1" }, name: "Dune", shortcut: true }),
    createElement(CollectionShortcut, { run: openCollections }),
  );
const star = () => document.querySelector<HTMLButtonElement>("button[aria-pressed]")!;

describe("A then F and A then C (SLN-571)", () => {
  it("favourites the page's item with A then F, and bare F does nothing", async () => {
    itemPage();
    press("f");
    expect(star().getAttribute("aria-pressed")).toBe("false");
    press("a");
    press("f");
    await act(async () => {});
    expect(star().getAttribute("aria-pressed")).toBe("true");
    expect(favourites.setFavourite).toHaveBeenCalledTimes(1);
    expect(favourites.setFavourite).toHaveBeenCalledWith("work", "w1", true);
    expect(nav.push).not.toHaveBeenCalled();
    expect(star().dataset.tooltipKeys).toBe("a then f");
  });

  it("opens the item's collections with A then C, not Create collection", () => {
    itemPage();
    press("a");
    press("c");
    expect(openCollections).toHaveBeenCalledTimes(1);
    expect(document.getElementById("create-collection")).toBeNull();
    expect(itemKeys().sort()).toEqual(["c", "f"]);
  });

  it("adds a film and creates a collection where no item takes the keys", () => {
    render();
    expect(itemKeys()).toEqual([]);
    press("a");
    press("f");
    expect(nav.push).toHaveBeenCalledWith("/films/new");
    // A pause, as a person makes: a fast key after a pick is dropped (SLN-1190)
    const later = performance.now() + 1000;
    const clock = vi.spyOn(performance, "now").mockReturnValue(later);
    press("a");
    press("c");
    expect(document.getElementById("create-collection")).not.toBeNull();
    clock.mockRestore();
  });

  it("forgets the item's keys when the item leaves the page", () => {
    itemPage();
    render();
    press("a");
    press("f");
    expect(favourites.setFavourite).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/films/new");
  });

  it("says both meanings in the shortcuts sheet", () => {
    const add = SHORTCUT_GROUPS.find((g) => g.title === "Add")!;
    const label = (keys: string) => add.items.find((i) => i.keys.join(" ") === keys)?.label;
    expect(label("a f")).toBe("Film, or favourite the page's item");
    expect(label("a c")).toBe("Collection, or add the page's item to a collection");
  });
});
