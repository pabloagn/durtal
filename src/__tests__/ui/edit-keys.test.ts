// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";

// SLN-633: E then a letter opens the same edit and media dialogs as the
// page's own buttons, on every detail page that has them.

const nav = vi.hoisted(() => ({
  pathname: "/collections/c1",
  router: { push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  // One router object: a new one each render would re-register the page's keys forever
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/notifications/toast", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/app/(catalogue)/people/author-create-dialog", () => ({ AuthorCreateDialog: () => null }));
vi.mock("@/app/(catalogue)/places/venue-create-dialog", () => ({ VenueCreateDialog: () => null }));
vi.mock("@/components/collections/create-collection-dialog", () => ({ CreateCollectionDialog: () => null }));
vi.mock("@/components/recommenders/recommender-form-dialog", () => ({ RecommenderFormDialog: () => null }));
vi.mock("@/components/series/series-form-dialog", () => ({ SeriesFormDialog: () => null }));
vi.mock("@/components/shortcuts/shortcuts-help", () => ({ ShortcutsHelp: () => null }));
vi.mock("@/lib/actions/collections", () => ({
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  moveCollectionMember: vi.fn(),
  removeEditionFromCollection: vi.fn(),
  removeWorksFromCollection: vi.fn(),
}));
vi.mock("@/lib/actions/films", () => ({ deleteFilm: vi.fn() }));
// The media editor and the film form stand in as markers: which one opened
vi.mock("@/components/media/media-manager-dialog", () => ({
  MediaManagerDialog: ({ open }: { open: boolean }) => (open ? createElement("div", { id: "media-editor" }) : null),
}));
vi.mock("@/components/films/film-form", () => ({
  FilmForm: () => createElement("div", { id: "film-form" }),
}));
vi.mock("@/components/books/add-to-collection-dialog", () => ({
  AddToCollectionDialog: () => null,
  CollectionShortcut: () => null,
}));
vi.mock("@/components/collections/add-books-dialog", () => ({ AddCollectionBooksDialog: () => null }));

import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { CollectionControls } from "@/components/collections/collection-controls";
import { FilmActions } from "@/components/films/film-actions";
import { EDIT_KEYS, SHORTCUT_GROUPS, editHint } from "@/lib/shortcuts/shortcuts";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
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

function render(child: ReturnType<typeof createElement>) {
  act(() =>
    root.render(
      createElement(ShortcutsProvider, { paletteOpen: false, onPaletteOpenChange: () => {}, children: child }),
    ),
  );
}
function press(key: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
}
const openDialogs = () => document.querySelectorAll("dialog[open]");

describe("E then a letter (SLN-633)", () => {
  it("opens Edit collection with E then C and its artwork with E then M, once", () => {
    const collection = { id: "c1", name: "Decadents", description: "" } as Parameters<typeof CollectionControls>[0]["collection"];
    render(createElement(CollectionControls, { collection, editionIds: [] }));
    press("e");
    expect(document.querySelector('[role="menu"][aria-label="Edit"]')?.textContent).toContain("Collection");
    press("c");
    expect(openDialogs()).toHaveLength(1);
    expect(openDialogs()[0].querySelector("textarea")).not.toBeNull();
    // The same keys again while the dialog is open open nothing more
    const box = openDialogs()[0].querySelector("textarea")!;
    press("e", box);
    press("c", box);
    expect(openDialogs()).toHaveLength(1);
    expect(document.getElementById("media-editor")).toBeNull();
  });

  it("opens the collection's artwork editor with E then M", () => {
    const collection = { id: "c1", name: "Decadents", description: "" } as Parameters<typeof CollectionControls>[0]["collection"];
    render(createElement(CollectionControls, { collection, editionIds: [] }));
    press("e");
    press("m");
    expect(document.getElementById("media-editor")).not.toBeNull();
    expect(openDialogs()).toHaveLength(0);
  });

  it("opens Edit film with E then W, and its images with E then M", () => {
    nav.pathname = "/films/stalker";
    const film = { id: "f1", title: "Stalker" } as Parameters<typeof FilmActions>[0]["film"];
    render(
      createElement(FilmActions, {
        film,
        fingerprint: "x",
        choices: {} as Parameters<typeof FilmActions>[0]["choices"],
        sources: [],
        copies: 0,
      }),
    );
    press("e");
    press("w");
    expect(document.getElementById("film-form")).not.toBeNull();
    expect(openDialogs()[0]?.textContent).toContain("Edit film");
    expect(document.getElementById("media-editor")).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    render(
      createElement(FilmActions, {
        film,
        fingerprint: "x",
        choices: {} as Parameters<typeof FilmActions>[0]["choices"],
        sources: [],
        copies: 0,
      }),
    );
    press("e");
    press("m");
    expect(document.getElementById("media-editor")).not.toBeNull();
    expect(openDialogs()).toHaveLength(0);
  });

  it("does nothing on E then a letter the page does not have", () => {
    nav.pathname = "/films/stalker";
    const film = { id: "f1", title: "Stalker" } as Parameters<typeof FilmActions>[0]["film"];
    render(
      createElement(FilmActions, {
        film,
        fingerprint: "x",
        choices: {} as Parameters<typeof FilmActions>[0]["choices"],
        sources: [],
        copies: 0,
      }),
    );
    press("e");
    press("c");
    expect(openDialogs()).toHaveLength(0);
    expect(document.getElementById("media-editor")).toBeNull();
  });

  // Every detail page registers its letters with the action that its own
  // button or menu item runs, and the menu shows the same keys
  const PAGES: [string, (keyof typeof EDIT_KEYS)[]][] = [
    ["src/app/(catalogue)/library/[slug]/work-actions-menu.tsx", ["work", "media", "taxonomy"]],
    ["src/components/films/film-actions.tsx", ["work", "media"]],
    ["src/components/perfumes/perfume-actions.tsx", ["work", "media"]],
    ["src/components/paintings/painting-actions.tsx", ["work", "media"]],
    ["src/app/(catalogue)/people/[slug]/author-detail-header.tsx", ["person", "media"]],
    ["src/components/publishers/publisher-header.tsx", ["publisher", "media"]],
    ["src/components/organizations/organization-actions.tsx", ["organization"]],
    ["src/components/collections/collection-controls.tsx", ["collection", "media"]],
    ["src/components/series/series-actions.tsx", ["series"]],
    ["src/app/(catalogue)/places/[slug]/venue-actions.tsx", ["place"]],
    ["src/app/(catalogue)/recommenders/[id]/recommender-actions.tsx", ["recommender"]],
  ];
  it.each(PAGES)("%s registers E then its letters and shows them", (file, names) => {
    const source = readFileSync(file, "utf8");
    const registered = source.slice(source.indexOf("useEditActions(["), source.indexOf("]);", source.indexOf("useEditActions([")));
    for (const name of names) {
      expect(registered).toContain(`key: EDIT_KEYS.${name}`);
      expect(source).toMatch(new RegExp(`(editHint|editTooltipKeys)\\(EDIT_KEYS\\.${name}\\)`));
    }
  });

  it("lists every letter in the shortcut sheet", () => {
    const sheet = SHORTCUT_GROUPS.find((g) => g.title === "Edit")!.items.map((i) => i.keys.join(" "));
    for (const key of new Set(Object.values(EDIT_KEYS))) expect(sheet).toContain(`e ${key}`);
    expect(editHint(EDIT_KEYS.collection)).toBe("E C");
  });
});
