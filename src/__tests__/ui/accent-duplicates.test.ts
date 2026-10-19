// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// A name typed without its accents is the record that has them (SLN-1015):
// "decadents" finds and adds to "Décadents", and "Emile Zola" is not offered
// as a new person beside "Émile Zola".

const action = vi.hoisted(() => ({ select: vi.fn(), create: vi.fn(), add: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/lib/activity/refresh-event", () => ({ triggerActivityRefresh: () => {} }));
vi.mock("@/components/collections/collection-icon-lazy", () => ({ CollectionIconLazy: () => null }));
vi.mock("@/lib/actions/collections", () => ({
  getCollectionSelection: action.select,
  getCollectionTally: async () => null,
  createCollection: action.create,
  addToCollection: action.add,
  removeFromCollection: vi.fn(),
}));
import { AddToCollectionDialog } from "@/components/books/add-to-collection-dialog";
import { SearchPicker } from "@/components/catalogue/search-picker";

const work = "00000000-0000-4000-a000-000000000001";
const edition = "00000000-0000-4000-a000-000000000011";
const decadents = "00000000-0000-4000-a000-000000000021";

let root: Root, host: HTMLDivElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  Object.values(action).forEach((fn) => fn.mockReset());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const settle = (ms = 20) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Add to collection", () => {
  beforeEach(async () => {
    action.select.mockResolvedValue({
      editions: [{ id: edition, workId: work, title: "Against Nature", publisher: null, publicationYear: null, language: "en", isbn13: null }],
      works: [],
      collections: [{ id: decadents, name: "Décadents", icon: null, tally: { editions: 0, byEdition: 0, books: 0, films: 0, perfumes: 0, paintings: 0 }, editionIds: [], workIds: [] }],
    });
    action.add.mockResolvedValue({ changed: 1 });
    act(() => root.render(createElement(AddToCollectionDialog, { open: true, onClose: () => {}, workIds: [work], title: "Against Nature" })));
    await settle();
    type(document.querySelector<HTMLInputElement>('input[aria-label="Find or create a collection"]')!, "decadents");
  });

  it("lists the collection with accents for a name typed without them", () => {
    expect(document.querySelector('[role="checkbox"][aria-label="Décadents"]')).not.toBeNull();
  });

  it("adds to it rather than creating a second one", async () => {
    const submit = document.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    expect(submit.textContent).toBe("Add");
    await act(async () => submit.click());
    await settle();
    expect(action.create).not.toHaveBeenCalled();
    expect(action.add.mock.calls[0][0]).toBe(decadents);
  });
});

describe("a record picker's Create offer", () => {
  const render = (choices: { id: string; label: string }[]) =>
    act(() => root.render(createElement(SearchPicker, {
      label: "Search people", placeholder: "Search people", search: async () => choices,
      onPick: () => {}, onCreate: async (name: string) => ({ id: "new", label: name }), onClose: () => {},
    })));
  const offers = () => [...host.querySelectorAll("button")].map((b) => b.textContent);

  it("offers no Create beside the same name with its accents", async () => {
    render([{ id: "zola", label: "Émile Zola" }]);
    type(host.querySelector("input")!, "emile ZOLA");
    await settle(200);
    expect(offers()).toEqual(["Émile Zola"]);
  });

  it("still offers Create for a different name", async () => {
    render([{ id: "zola", label: "Émile Zola" }]);
    type(host.querySelector("input")!, "Emile Zolas");
    await settle(200);
    expect(offers()).toEqual(["Émile Zola", "Create “Emile Zolas”"]);
  });
});
