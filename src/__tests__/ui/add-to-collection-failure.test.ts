// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// A failed collection change reads the collections again (SLN-573) and keeps
// the editions the reader chose, so retrying changes what they meant to.

const action = vi.hoisted(() => ({
  select: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: () => {}, error: action.error } }));
vi.mock("@/lib/activity/refresh-event", () => ({ triggerActivityRefresh: () => {} }));
vi.mock("@/components/collections/collection-icon-lazy", () => ({ CollectionIconLazy: () => null }));
vi.mock("@/lib/actions/collections", () => ({
  getCollectionSelection: action.select,
  createCollection: vi.fn(),
  addToCollection: action.add,
  removeFromCollection: action.remove,
}));
import { AddToCollectionDialog } from "@/components/books/add-to-collection-dialog";

const work = "00000000-0000-4000-a000-000000000001";
const loose = "00000000-0000-4000-a000-000000000002";
const hardback = "00000000-0000-4000-a000-000000000011";
const paperback = "00000000-0000-4000-a000-000000000012";
const collection = "00000000-0000-4000-a000-000000000021";
function selection(members: { editions?: string[]; works?: string[] } = {}) {
  return {
    editions: [
      { id: hardback, workId: work, title: "Against Nature (hardback)", publisher: null, publicationYear: null, language: "en", isbn13: null },
      { id: paperback, workId: work, title: "Against Nature (paperback)", publisher: null, publicationYear: null, language: "en", isbn13: null },
    ],
    works: [{ id: loose, title: "En route", kind: "book" }],
    collections: [{
      id: collection, name: "Decadents", icon: null,
      collectionEditions: (members.editions ?? []).map((editionId) => ({ editionId, edition: { workId: work } })),
      collectionWorks: (members.works ?? []).map((workId) => ({ workId })),
      media: [],
    }],
  };
}

let root: Root, host: HTMLDivElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  Object.values(action).forEach((fn) => fn.mockReset());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const box = (name: string) => [...document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((input) => input.parentElement?.textContent?.includes(name))!;
const row = () => document.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="Decadents"]')!;
const summary = () => [...document.querySelectorAll("summary")].map((node) => node.textContent).join("");

async function open() {
  act(() => root.render(createElement(AddToCollectionDialog, { open: true, onClose: () => {}, workIds: [work, loose], title: "2 selected books" })));
  await settle();
  // The reader keeps the hardback only
  act(() => box("paperback").click());
  expect(summary()).toContain("1 of 2 editions selected");
}

describe("the Add to collection dialog after a failed change", () => {
  it("keeps the chosen editions when an addition fails, so a retry adds only those", async () => {
    action.select.mockResolvedValue(selection());
    action.add.mockRejectedValueOnce(new Error("refused")).mockResolvedValueOnce({ changed: 2 });
    await open();
    act(() => row().click());
    await settle();
    expect(action.error).toHaveBeenCalledWith("Could not update this collection. Nothing was changed.");
    expect(action.select).toHaveBeenCalledTimes(2);
    expect(summary()).toContain("1 of 2 editions selected");
    act(() => row().click());
    await settle();
    expect(action.add).toHaveBeenLastCalledWith(collection, { editionIds: [hardback], workIds: [loose] });
  });

  it("keeps the chosen editions when a removal fails, so the row still reads as all in and a retry removes", async () => {
    action.select.mockResolvedValueOnce(selection()).mockResolvedValue(selection({ editions: [hardback], works: [loose] }));
    action.add.mockResolvedValue({ changed: 2 });
    action.remove.mockRejectedValueOnce(new Error("refused")).mockResolvedValueOnce({ changed: 2 });
    await open();
    act(() => row().click());
    await settle();
    expect(row().getAttribute("aria-checked")).toBe("true");
    act(() => row().click());
    await settle();
    expect(action.error).toHaveBeenCalledTimes(1);
    expect(row().getAttribute("aria-checked")).toBe("true");
    act(() => row().click());
    await settle();
    expect(action.remove).toHaveBeenLastCalledWith(collection, { editionIds: [hardback], workIds: [loose] });
    expect(action.add).toHaveBeenCalledTimes(1);
  });

  it("drops a chosen edition that is gone when the collections are read again", async () => {
    action.select.mockResolvedValueOnce(selection()).mockResolvedValue({ ...selection(), editions: selection().editions.slice(1) });
    action.add.mockRejectedValueOnce(new Error("gone"));
    await open();
    act(() => row().click());
    await settle();
    expect(row().disabled).toBe(false);
    act(() => row().click());
    await settle();
    expect(action.add).toHaveBeenLastCalledWith(collection, { editionIds: [], workIds: [loose] });
  });
});
