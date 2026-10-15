// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// Design polish 3 (SLN-798): on a phone the list view cut every title and
// author to a letter or two, and on a desktop a row's status and year moved
// with its Read link. Titles and authors now wrap in full; under 640px the
// marks, year and copies go under the author; rows keep the Read link's room.

vi.mock("@/components/shared/favourite-toggle", () => ({ FavouriteToggle: () => createElement("button", { "aria-label": "Favourite" }) }));
vi.mock("@/components/books/copy-book-button", () => ({ CopyBookButton: () => createElement("button", { "aria-label": "Copy" }) }));
vi.mock("@/components/ebooks/catalogue-read-action", () => ({ CatalogueReadLink: () => createElement("a", { "data-read": "" }, "Read") }));
vi.mock("next/image", () => ({ default: () => null }));

import { BookList } from "@/components/books/book-list";

const LONG = "Memoirs of Hadrian, with the Notebooks and the Reflections on the Composition of the Memoirs";
const book = (workId: string, title: string, readable: boolean) => ({
  workId, slug: workId, title, authorName: "Marguerite Yourcenar", instanceCount: 1, publicationYear: 1951,
  catalogueStatus: "tracked", isFavourite: false,
  ebook: readable ? ({ readable: true, readerPath: `/reader/${workId}` } as never) : null,
});

let root: Root, host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("wraps titles and authors in full and keeps the Read link's room in every row", async () => {
  await act(async () => root.render(createElement(BookList, { books: [book("a", LONG, true), book("b", "The Abyss", false)] })));
  const rows = [...host.querySelectorAll("[data-book-row]")];
  expect(rows).toHaveLength(2);
  const title = rows[0].querySelector("[data-book-row-title]")!;
  expect(title.textContent).toBe(LONG);
  expect(title.className).not.toContain("truncate");
  expect(rows[0].querySelector("p")!.className).not.toContain("truncate");
  expect(rows[0].querySelector("[data-read]")).not.toBeNull();
  expect(rows[1].querySelector("[data-read-slot]")?.getAttribute("aria-hidden")).toBe("true");
});

it("puts the marks, year and copies under the author in a narrow list", async () => {
  await act(async () => root.render(createElement(BookList, { books: [book("b", "The Abyss", false)] })));
  const facts = host.querySelector("[data-book-row-facts]")!;
  expect(facts.className).toContain("@[40rem]/list:hidden");
  expect(facts.textContent).toContain("Tracked");
  expect(facts.textContent).toContain("1951");
  expect(facts.textContent).toContain("1 copy");
  // No reader link anywhere: no room kept for one
  expect(host.querySelector("[data-read-slot]")).toBeNull();
});
