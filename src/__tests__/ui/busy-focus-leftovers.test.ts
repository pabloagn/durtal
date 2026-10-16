// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/taxonomy/genres",
}));

import { Button } from "@/components/ui/button";
import { FocusKeeper } from "@/components/shared/focus-keeper";
import { TaxonomyTree } from "@/components/taxonomy/taxonomy-tree";

// SLN-920, from the review of #450: the busy-state focus leftovers. A busy
// button takes a second click itself; New collection's fields stay focusable
// while it saves; a merged or deleted taxonomy item hands the focus on; a new
// collection or series opens its Add dialog from its Add button.

const SRC = path.resolve(__dirname, "../..");
const source = (file: string) => readFileSync(path.join(SRC, file), "utf8");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const frame = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));

describe("a busy button", () => {
  it("takes a click itself instead of letting it through to the dialog", () => {
    const markup = document.createElement("div");
    markup.innerHTML = renderToStaticMarkup(h(Button, { busy: true }, "Merge"));
    const button = markup.querySelector("button")!;
    expect(button.className).not.toContain("pointer-events-none");
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("ignores that click", () => {
    const onClick = vi.fn();
    act(() => root.render(h(Button, { busy: true, onClick }, "Merge")));
    const button = host.querySelector("button")!;
    button.focus();
    act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });
});

describe("New collection while it saves", () => {
  it("keeps Name and Description read-only, never disabled", () => {
    const text = source("components/collections/create-collection-dialog.tsx");
    const name = text.slice(text.indexOf('label="Name"'), text.indexOf("/>", text.indexOf('label="Name"')));
    const description = text.slice(text.indexOf('label="Description"'), text.indexOf("/>", text.indexOf('label="Description"')));
    for (const field of [name, description]) {
      expect(field).toContain("readOnly={saving}");
      expect(field).not.toContain("disabled=");
    }
  });
});

const item = (id: string, sortOrder: number) => ({
  id,
  name: id,
  slug: id.toLowerCase(),
  color: null,
  entityCount: 1,
  parentId: null,
  sortOrder,
});

function Family({ names }: { names: string[] }) {
  const noop = async () => {};
  return h(
    "main",
    null,
    h(FocusKeeper),
    h("h1", null, "Genres"),
    h("button", { "data-focus-empty": "taxonomy-items" }, "New item"),
    names.length > 0 &&
      h(TaxonomyTree, {
        items: names.map((name, index) => item(name, index)),
        familySlug: "genres",
        hierarchical: false,
        selectedIds: new Set<string>(),
        onSelectionChange: () => {},
        onReorder: noop,
        onMove: noop,
        onColorChange: noop,
        onRename: noop,
        onDelete: () => {},
        onMerge: () => {},
      }),
  );
}
const actions = () => [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="Actions"]')];

describe("a merged or deleted taxonomy item", () => {
  it("hands the focus to the next row's Actions", async () => {
    act(() => root.render(h(Family, { names: ["Gothic", "Horror", "Weird"] })));
    actions()[1].focus();
    act(() => root.render(h(Family, { names: ["Gothic", "Weird"] })));
    await frame();
    expect(document.activeElement).toBe(actions()[1]);
    expect(actions()[1].closest("[data-focus-row]")?.textContent).toContain("Weird");
  });

  it("hands it to the row before when the last goes, then to New item", async () => {
    act(() => root.render(h(Family, { names: ["Gothic", "Horror"] })));
    actions()[1].focus();
    act(() => root.render(h(Family, { names: ["Gothic"] })));
    await frame();
    expect(document.activeElement).toBe(actions()[0]);
    act(() => root.render(h(Family, { names: [] })));
    await frame();
    expect(document.activeElement?.textContent).toBe("New item");
  });

  it("marks both of the family page's New item buttons as the list's Add", () => {
    const text = source("app/(catalogue)/taxonomy/[familySlug]/taxonomy-family-shell.tsx");
    expect(text.match(/data-focus-empty="taxonomy-items"/g)).toHaveLength(2);
    // The newly created item, not the replacement toolbar, receives focus.
    expect(text).toContain("firstItem.current = id");
    expect(text).toContain("data-taxonomy-item-name");
  });
});

describe("a new collection or series", () => {
  it("opens its Add dialog from its Add button, which takes the focus back", () => {
    for (const file of ["components/collections/collection-controls.tsx", "components/series/series-actions.tsx"]) {
      const text = source(file);
      expect(text).not.toMatch(/useState\(initialAdd\)/);
      expect(text).toMatch(/addButton\.current\?\.focus\(\)/);
    }
  });
});
