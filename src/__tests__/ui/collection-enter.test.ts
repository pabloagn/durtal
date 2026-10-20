// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-1350: Enter in Add to collection adds to the one collection the name
// finds ("deca" adds to Decadents) and creates only when the name finds none,
// or several and none by that exact name. The button says which.

const action = vi.hoisted(() => ({ select: vi.fn(), create: vi.fn(), add: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/lib/activity/refresh-event", () => ({ triggerActivityRefresh: () => {} }));
vi.mock("@/components/collections/collection-icon-lazy", () => ({ CollectionIconLazy: () => null }));
vi.mock("@/lib/actions/collections", () => ({ getCollectionSelection: action.select, getCollectionTally: async () => null }));
vi.mock("@/lib/actions/catalogue-client", () => ({
  createCollection: action.create,
  addToCollection: action.add,
  removeFromCollection: vi.fn(),
}));
import { AddToCollectionDialog } from "@/components/books/add-to-collection-dialog";

const work = "00000000-0000-4000-a000-000000000001";
const edition = "00000000-0000-4000-a000-000000000011";
const tally = { editions: 0, byEdition: 0, books: 0, films: 0, perfumes: 0, paintings: 0 };
const collection = (id: string, name: string) => ({ id, name, icon: null, tally, editionIds: [], workIds: [] });
const decadents = "00000000-0000-4000-a000-000000000021";
const decay = "00000000-0000-4000-a000-000000000022";
const symbolists = "00000000-0000-4000-a000-000000000023";

let root: Root, host: HTMLDivElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  Object.values(action).forEach((fn) => fn.mockReset());
  action.add.mockResolvedValue({ changed: 1 });
  action.create.mockImplementation(async ({ name }: { name: string }) => ({ id: "new", name, icon: null }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const submit = () => document.querySelector<HTMLButtonElement>('form button[type="submit"]')!;

async function openWith(names: [string, string][], typed: string) {
  action.select.mockResolvedValue({
    editions: [{ id: edition, workId: work, title: "Against Nature", publisher: null, publicationYear: null, language: "en", isbn13: null }],
    works: [],
    collections: names.map(([id, name]) => collection(id, name)),
  });
  act(() => root.render(createElement(AddToCollectionDialog, { open: true, onClose: () => {}, workIds: [work], title: "Against Nature" })));
  await settle();
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Find or create a collection"]')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { set.call(input, typed); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function enter() {
  await act(async () => submit().click());
  await settle();
}

describe("Enter in Add to collection", () => {
  it("adds to the one collection part of a name finds", async () => {
    await openWith([[decadents, "Decadents"], [symbolists, "Symbolists"]], "deca");
    expect(submit().textContent).toBe("Add");
    expect(submit().getAttribute("aria-label")).toBe("Add to Decadents");
    expect(document.querySelector('[role="checkbox"][aria-label="Decadents"]')?.className).toContain("bg-bg-tertiary");
    await enter();
    expect(action.create).not.toHaveBeenCalled();
    expect(action.add.mock.calls[0][0]).toBe(decadents);
  });

  it("adds to the collection with the exact name among several matches", async () => {
    await openWith([[decay, "Décadence"], [decadents, "Décadence fin de siècle"]], "decadence");
    expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    expect(submit().getAttribute("aria-label")).toBe("Add to Décadence");
    await enter();
    expect(action.add.mock.calls[0][0]).toBe(decay);
  });

  it("creates when part of a name finds several and none by that name", async () => {
    await openWith([[decay, "Decay"], [decadents, "Decadents"]], "deca");
    expect(submit().textContent).toBe("Create & add");
    expect(submit().getAttribute("aria-label")).toBe("Create & add “deca”");
    expect(document.querySelector(".bg-bg-tertiary[role=checkbox]")).toBeNull();
    await enter();
    expect(action.add).not.toHaveBeenCalled();
    expect(action.create.mock.calls[0][0]).toEqual({ name: "deca" });
  });

  it("creates when the name finds nothing", async () => {
    await openWith([[decadents, "Decadents"]], "Naturalists");
    expect(submit().textContent).toBe("Create & add");
    await enter();
    expect(action.add).not.toHaveBeenCalled();
    expect(action.create.mock.calls[0][0]).toEqual({ name: "Naturalists" });
  });
});
