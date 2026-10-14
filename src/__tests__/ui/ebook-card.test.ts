// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) =>
    createElement("a", props, children as never),
}));
import { EbookCard } from "@/components/ebooks/ebook-card";
import { ebookCardData } from "@/lib/ebooks/library-view";
import type { LibraryEbook } from "@/lib/ebooks/library-queries";
import { publicationFixture } from "../ebooks/publication-fixture";
let root: Root, host: HTMLElement;
// The reader only opens real ids: a Read link is a document link to them (SLN-683)
const BOOK = "00000000-0000-4000-a000-000000000001";
const FILE = "00000000-0000-4000-a000-f00000000001";
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function book(): LibraryEbook {
  return {
    id: BOOK,
    title: "A deliberately long title that wraps naturally in the ebook card",
    subtitle: null,
    authors: ["A writer with a long name", "Another writer"],
    language: "en",
    matchState: "linked",
    preferredFileId: FILE,
    coverKey: null,
    createdAt: "2026-10-09T10:00:00Z",
    files: [
      {
        ...publicationFixture(),
        id: FILE,
        ebookId: BOOK,
        createdAt: "2026-10-09T10:00:00Z",
        coverKey: null,
        verifiedAt: null,
        quarantineReason: null,
        sourceHost: null,
        sourcePath: null,
      },
    ],
  };
}
describe("ebook cards", () => {
  it("links the card to its detail, pins eligible Read bytes, and names its linked mark accessibly", () => {
    const ebook = book();
    act(() =>
      root.render(
        createElement(EbookCard, { book: ebookCardData(ebook, null), returnTo: "/ebooks?q=long" }),
      ),
    );
    const read = host.querySelector('a[aria-label^="Read "]');
    expect(read?.getAttribute("href")).toBe(`/reader/${BOOK}?file=${FILE}&returnTo=%2Febooks%3Fq%3Dlong`);
    expect(read?.hasAttribute("data-reader-entry")).toBe(true);
    expect(host.querySelector(`a[href="/ebooks/${BOOK}"]`)).not.toBeNull();
    const mark = host.querySelector('[aria-label="Linked to its book"]');
    expect(mark?.getAttribute("data-tooltip")).toBe("Linked to its book");
    expect(host.textContent).toContain(ebook.title);
    expect(host.querySelector(".lines-2")).toBeNull();
  });
  it.each(["quarantined", "missing", "replaced"])(
    "never offers Read for %s-only files",
    (status) => {
      const ebook = book();
      ebook.files[0].status = status;
      act(() =>
        root.render(
          createElement(EbookCard, { book: ebookCardData(ebook, null) }),
        ),
      );
      expect(host.querySelector('a[aria-label^="Read "]')).toBeNull();
      expect(host.textContent).toContain("EPUB");
    },
  );
  it("does not offer Read for protected files or excluded books", () => {
    const ebook = book();
    ebook.files[0].drm = "adobe-adept";
    act(() =>
      root.render(
        createElement(EbookCard, { book: ebookCardData(ebook, null) }),
      ),
    );
    expect(host.querySelector('a[aria-label^="Read "]')).toBeNull();
    ebook.files[0].drm = null;
    ebook.matchState = "excluded";
    act(() =>
      root.render(
        createElement(EbookCard, { book: ebookCardData(ebook, null) }),
      ),
    );
    expect(host.querySelector('a[aria-label^="Read "]')).toBeNull();
  });
});
