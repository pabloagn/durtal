// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// A search in Add to collection or a series' Add books is not unsaved work:
// the rows it finds changed the dialog's fields, so Esc asked "Unsaved
// changes" with nothing picked. Only picked books ask first.

const rows = (query: string) =>
  (query ? [
    { workId: "w2", title: "The Magic Mountain", creators: "Thomas Mann", kind: "book", imageS3Key: null },
    { workId: "w3", title: "Against Nature", creators: "J.-K. Huysmans", kind: "book", imageS3Key: null },
  ]
    : [{ workId: "w1", title: "The Cathedral", creators: "J.-K. Huysmans", kind: "book", imageS3Key: null }]);
vi.mock("@/lib/actions/collections", () => ({
  searchEditionsForPicker: vi.fn(async () => []),
  searchWorksForCollection: vi.fn(async (query: string) => rows(query)),
  addToCollection: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/actions/series", () => ({
  searchWorksForSeries: vi.fn(async () => [
    { id: "w2", title: "The Magic Mountain", authors: "Thomas Mann", seriesId: null, seriesTitle: null, cover: null },
    { id: "w3", title: "Against Nature", authors: "J.-K. Huysmans", seriesId: null, seriesTitle: null, cover: null },
  ]),
  addWorksToSeries: vi.fn(async () => ({ added: 1 })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AddCollectionBooksDialog } from "@/components/collections/add-books-dialog";
import { AddSeriesBooksDialog } from "@/components/series/add-series-books-dialog";

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

const wait = (ms = 10) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
function escape(target: Element) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
  });
}
function type(field: HTMLInputElement, value: string) {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const prompt = () =>
  [...document.querySelectorAll("dialog[open]")].find((d) => d.textContent?.includes("Unsaved changes")) ?? null;

async function openDialog(onClose: () => void) {
  act(() => {
    root.render(createElement(AddCollectionBooksDialog, { open: true, onClose, collectionId: "c1", existingIds: [] }));
  });
  await wait();
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search books to add"]')!;
  expect(search).not.toBeNull();
  return search;
}

describe("Add to collection", () => {
  it("closes on one Esc after a search with nothing picked", async () => {
    const onClose = vi.fn();
    const search = await openDialog(onClose);
    type(search, "Magic");
    await wait(300);
    expect(document.body.textContent).toContain("The Magic Mountain");
    escape(search);
    expect(prompt()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks first once a book is picked", async () => {
    const onClose = vi.fn();
    const search = await openDialog(onClose);
    const box = document.querySelector<HTMLInputElement>('input[aria-label^="Select The Cathedral"]')!;
    act(() => {
      box.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      box.click();
    });
    escape(search);
    expect(prompt()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a series' Add books", () => {
  async function openSeries(onClose: () => void) {
    act(() => {
      root.render(createElement(AddSeriesBooksDialog, { open: true, onClose, seriesId: "s1", seriesTitle: "Journey Series" }));
    });
    await wait(30);
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search books to add"]')!;
    type(search, "Magic");
    await wait(300);
    expect(document.body.textContent).toContain("The Magic Mountain");
    return search;
  }

  it("closes on one Esc after a search with nothing picked", async () => {
    const onClose = vi.fn();
    const search = await openSeries(onClose);
    escape(search);
    expect(prompt()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks first once a book is picked", async () => {
    const onClose = vi.fn();
    const search = await openSeries(onClose);
    const box = document.querySelector<HTMLInputElement>('input[aria-label="Select The Magic Mountain"]')!;
    act(() => {
      box.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      box.click();
    });
    escape(search);
    expect(prompt()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
