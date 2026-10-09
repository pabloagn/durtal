// @vitest-environment happy-dom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SimilarWork } from "@/lib/catalogue/related-tiles";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) =>
    createElement("a", props, children as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/library",
}));
import { SimilarWorksCarousel } from "@/components/books/similar-works-carousel";
import { BookCard } from "@/components/books/book-card";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root, host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("related shelf presentation", () => {
  it("has no empty heading or explanation controls", () => {
    act(() => root.render(createElement(SimilarWorksCarousel, { works: [] })));
    expect(host.childElementCount).toBe(0);
  });

  it("uses actual kind routes and full identifying text without similarity captions", () => {
    const works: SimilarWork[] = (["film", "perfume", "painting"] as const).map(
      (kind) => ({
        id: kind,
        title: `A long ${kind} title about memory, grief and the shape of solitude`,
        kind,
        tile: {
          id: kind,
          title: `A long ${kind} title about memory, grief and the shape of solitude`,
          href: `/${kind === "film" ? "films" : kind === "perfume" ? "perfumes" : "paintings"}/correct-${kind}`,
          creators:
            kind === "film"
              ? "A director with a complete identifying name"
              : null,
          date: kind === "painting" ? "c. 1900–1905" : null,
          imageUrl: null,
          tone: null,
          rating: null,
          createdAt: new Date("2020-01-01"),
        },
      }),
    );
    act(() => root.render(createElement(SimilarWorksCarousel, { works })));
    expect(host.querySelector("h2")?.textContent).toBe("Similar Works");
    expect(
      [...host.querySelectorAll("a")].map((link) => link.getAttribute("href")),
    ).toEqual(
      works.map((work) => (work.kind !== "book" ? work.tile.href : "")),
    );
    for (const work of works) expect(host.textContent).toContain(work.title);
    expect(host.textContent).toContain(
      "A director with a complete identifying name",
    );
    expect(host.textContent).toContain("Unknown house");
    expect(host.textContent).toContain("Painter unknown");
    expect(host.textContent).toContain("c. 1900–1905");
    expect(host.querySelector("dialog")).toBeNull();
    expect(host.textContent).not.toContain("All reasons");
    expect(host.querySelector("[class*=line-clamp]")).toBeNull();
  });

  it("identifies a matching edition while keeping reading and marks in a book card", () => {
    const note =
      "A complete translated edition title · 1998 edition · Translated by Alice";
    act(() =>
      root.render(
        createElement(BookCard, {
          workId: "book",
          slug: "book",
          title: "Book",
          authorName: "Author",
          editionNote: note,
          instanceCount: 1,
          catalogueStatus: "accessioned",
          isRare: true,
          huntAssessedOn: "2026-10-09",
          isPoison: true,
          reading: { state: "reading", percent: 42 },
        }),
      ),
    );
    expect(host.textContent).toContain(note);
    expect(host.querySelector("[data-card-reading]")?.textContent).toBe(
      "Reading 42%",
    );
    expect(host.querySelector('[aria-label^="Rare"]')).not.toBeNull();
    expect(host.querySelector('[aria-label^="Anathema"]')).not.toBeNull();
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/library/book");
  });
});
