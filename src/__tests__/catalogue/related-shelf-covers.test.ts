import { beforeEach, describe, expect, it, vi } from "vitest";

// SLN-999: an edition set to follow the book's cover keeps no cover of its
// own, so its card on a "More from" or "More translated by" shelf showed the
// letter. An edition's card now shows what the edition shows on its book
// page: its own cover, else the book's poster.

const cards = vi.hoisted(() => ({ books: new Map(), editions: new Map() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/catalogue/related-books", () => ({ loadRelatedBooks: vi.fn(async () => cards) }));

import { relatedGroupsFrom, type RelatedBookRow } from "@/lib/catalogue/related-groups";
import { cardImage, type WorkCardData } from "@/components/books/work-carousel";

const poster = { s3Key: "media/poster.jpg", thumbnailS3Key: "media/poster-thumb.jpg", type: "poster", isActive: true };
const edition = (id: string, cover: string | null, thumbnail = cover) => ({
  id,
  workId: "w1",
  title: "Augustus",
  coverS3Key: cover,
  thumbnailS3Key: thumbnail,
  publicationYear: 2014,
  language: "en",
  instances: [],
});
const row = (editionId: string): RelatedBookRow => ({
  kind: "publisher",
  sourceId: "p1",
  name: "New York Review Books",
  slug: "nyrb",
  workId: "w1",
  editionId,
});
const card = (fields: Record<string, unknown>) => fields as unknown as WorkCardData;

beforeEach(() => {
  cards.books = new Map([["w1", { id: "w1", title: "Augustus", editions: [edition("e0", "covers/e0.jpg")], media: [poster] }]]);
  cards.editions = new Map([
    ["own", edition("own", "covers/own.jpg")],
    ["follows", edition("follows", null)],
  ]);
});

describe("an edition's card on a related shelf", () => {
  it("is that edition's card and keeps the book's poster", async () => {
    const [group] = await relatedGroupsFrom([row("follows")]);
    const [book] = group.works;
    expect(book.editionCard).toBe(true);
    expect(book.editions.map((e) => e.id)).toEqual(["follows"]);
    expect(book.media).toEqual([poster]);
    expect(book.editionNote).toBe("Augustus · 2014 edition · Published by New York Review Books");
  });

  it("shows the book's poster when the edition follows the book's cover", async () => {
    const [group] = await relatedGroupsFrom([row("follows")]);
    expect(cardImage(group.works[0])).toMatchObject({ key: "media/poster-thumb.jpg", source: "poster" });
  });

  it("shows its own cover over the book's poster when it has one", async () => {
    const [group] = await relatedGroupsFrom([row("own")]);
    expect(cardImage(group.works[0])).toEqual({ key: "covers/own.jpg", crop: null, source: "edition" });
    // A thumbnail alone counts as its own cover
    const thumbnailOnly = card({ editionCard: true, editions: [edition("t", null, "covers/t-thumb.jpg")], media: [poster] });
    expect(cardImage(thumbnailOnly)?.key).toBe("covers/t-thumb.jpg");
  });
});

describe("a book's card", () => {
  it("shows the poster first, then the cover edition's cover", () => {
    expect(cardImage(card({ editions: [edition("e0", "covers/e0.jpg")], media: [poster] }))?.key).toBe("media/poster-thumb.jpg");
    expect(cardImage(card({ editions: [edition("e0", "covers/e0.jpg")], media: [] }))).toEqual({
      key: "covers/e0.jpg",
      crop: null,
      source: "edition",
    });
    expect(cardImage(card({ editions: [], media: [] }))).toBeNull();
  });
});
