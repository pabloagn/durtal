// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TaxonomyItemRow } from "@/components/taxonomy/taxonomy-item-row";

// Enter or Esc in a rename left focus on the page, so the next Tab started
// from the top. It goes back to the item's name.

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => h("a", props, children as never),
}));

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
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));
const key = (target: Element, name: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });

async function startRename(onRename = vi.fn()) {
  act(() =>
    root.render(
      h(TaxonomyItemRow, {
        item: { id: "g1", name: "Gothic", slug: "gothic", color: null, entityCount: 3 },
        familySlug: "film-genres",
        depth: 0,
        isSelected: false,
        onSelect: () => {},
        onColorChange: () => {},
        onRename,
        onDelete: () => {},
        onMerge: () => {},
      }),
    ),
  );
  act(() => (host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement).click());
  await settle();
  const rename = [...host.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes("Rename"))!;
  key(rename, "Enter");
  await settle();
  const input = host.querySelector("input") as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  return input;
}

describe("renaming a taxonomy item", () => {
  it("returns focus to the item's name on Esc", async () => {
    const input = await startRename();
    key(input, "Escape");
    await settle();
    expect(host.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('a[href="/taxonomy/film-genres/gothic"]'));
  });

  it("returns focus to the item's name on Enter", async () => {
    const onRename = vi.fn();
    const input = await startRename(onRename);
    key(input, "Enter");
    await settle();
    expect(document.activeElement).toBe(host.querySelector('a[href="/taxonomy/film-genres/gothic"]'));
  });
});
