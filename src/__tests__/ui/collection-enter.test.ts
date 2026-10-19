// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-1350: Enter in Add to collection's field took a partial match ("deca")
// as a new collection's name. It now does what the highlighted row says: the
// collection of that very name, else the first match; "Create" is a row of
// its own, the target only when nothing matches or the arrows reach it.

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

const work = "00000000-0000-4000-a000-000000000001";
const edition = "00000000-0000-4000-a000-000000000011";
const decadents = "00000000-0000-4000-a000-000000000021";
const decay = "00000000-0000-4000-a000-000000000022";

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

const tally = { editions: 0, byEdition: 0, books: 0, films: 0, perfumes: 0, paintings: 0 };
const field = () => document.querySelector<HTMLInputElement>('input[aria-label="Find or create a collection"]')!;
const submit = () => document.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
const active = () => [...document.querySelectorAll("[data-active]")].map((row) => row.textContent);
async function enter() {
  await act(async () => field().form!.requestSubmit());
  await settle();
}
function arrow(key: "ArrowDown" | "ArrowUp") {
  act(() => { field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
}

describe("Enter in Add to collection", () => {
  beforeEach(async () => {
    action.select.mockResolvedValue({
      editions: [{ id: edition, workId: work, title: "Against Nature", publisher: null, publicationYear: null, language: "en", isbn13: null }],
      works: [],
      collections: [
        { id: decadents, name: "Décadents", icon: null, tally, editionIds: [], workIds: [] },
        { id: decay, name: "Decay", icon: null, tally, editionIds: [edition], workIds: [] },
      ],
    });
    action.add.mockResolvedValue({ changed: 1 });
    action.create.mockResolvedValue({ id: "new", name: "Gothic", icon: null });
    act(() => root.render(createElement(AddToCollectionDialog, { open: true, onClose: () => {}, workIds: [work], title: "Against Nature" })));
    await settle();
  });

  it("adds to the one match of a partial name, and creates nothing", async () => {
    type(field(), "decad");
    expect(submit().textContent).toBe("Add to “Décadents”");
    expect(active()[0]).toContain("Décadents");
    await enter();
    expect(action.create).not.toHaveBeenCalled();
    expect(action.add.mock.calls[0][0]).toBe(decadents);
  });

  it("takes the collection of that very name over an earlier match", async () => {
    type(field(), "DECAY");
    expect(submit().textContent).toBe("Already in “Decay”");
    expect(submit().disabled).toBe(true);
    await enter();
    expect(action.add).not.toHaveBeenCalled();
    expect(action.create).not.toHaveBeenCalled();
  });

  it("offers Create as its own row, which the arrows reach", async () => {
    type(field(), "deca");
    expect(submit().textContent).toBe("Add to “Décadents”");
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Create “deca”")).toBe(true);
    arrow("ArrowUp");
    expect(submit().textContent).toBe("Create “deca”");
    arrow("ArrowDown");
    expect(submit().textContent).toBe("Add to “Décadents”");
    arrow("ArrowDown");
    expect(submit().textContent).toBe("Already in “Decay”");
    arrow("ArrowDown");
    arrow("ArrowDown");
    expect(submit().textContent).toBe("Add to “Décadents”");
  });

  it("creates and adds when nothing matches", async () => {
    type(field(), "Gothic");
    expect(submit().textContent).toBe("Create “Gothic”");
    await enter();
    expect(action.add).not.toHaveBeenCalled();
    expect(action.create.mock.calls[0][0]).toEqual({ name: "Gothic" });
  });

  it("starts each search on its first match again", () => {
    type(field(), "dec");
    arrow("ArrowDown");
    expect(submit().textContent).toBe("Already in “Decay”");
    type(field(), "deca");
    expect(submit().textContent).toBe("Add to “Décadents”");
  });
});
