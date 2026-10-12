import { afterEach, describe, expect, it, vi } from "vitest";
import { ebookCoverImage } from "@/lib/ebooks/library-cover";
import type { LibraryEbook } from "@/lib/ebooks/library-queries";
import { publicationFixture } from "./publication-fixture";
afterEach(() => vi.unstubAllEnvs());
function book(): LibraryEbook {
  return {
    id: "book",
    title: "Book",
    subtitle: null,
    authors: [],
    language: null,
    matchState: "pending",
    preferredFileId: "file",
    coverKey: null,
    createdAt: "2026-10-09T10:00:00Z",
    files: [
      {
        ...publicationFixture(),
        id: "file",
        ebookId: "book",
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
describe("page cover selection", () => {
  it("uses only the cover widths actually recorded in the publication", () => {
    const image = ebookCoverImage(book(), {
      base: "https://cdn.test/",
      query: "Policy=accepted",
      expiresAt: new Date(),
    });
    expect(image?.src).toContain("/cover-240.webp?Policy=accepted");
    expect(image?.srcSet).toContain("240w");
    expect(image?.srcSet).not.toContain("400w");
    expect(image?.srcSet).not.toContain("800w");
  });
  it("refuses malformed or undeliverable publication covers", () => {
    const ebook = book();
    ebook.files[0].metadata = {
      medallion: { gold: [{ key: "gold/cover-800.webp" }] },
    };
    expect(ebookCoverImage(ebook)).toBeNull();
    ebook.files[0] = {
      ...ebook.files[0],
      ...publicationFixture(),
      status: "replaced",
    };
    expect(ebookCoverImage(ebook)).toBeNull();
  });
});
