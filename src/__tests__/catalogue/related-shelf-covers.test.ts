import { beforeEach, describe, expect, it, vi } from "vitest";

// SLN-999: an edition set to follow the book's cover keeps no cover of its
// own, so its card on a "More from" or "More translated by" shelf showed the
// letter. The card now takes the book's cover, as the edition's own page does.

const cards = vi.hoisted(() => ({ books: new Map(), editions: new Map() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/catalogue/related-books", () => ({ loadRelatedBooks: vi.fn(async () => cards) }));

import { relatedGroupsFrom, type RelatedBookRow } from "@/lib/catalogue/related-groups";

const poster = { s3Key: "media/poster.jpg", thumbnailS3Key: "media/poster-thumb.jpg", type: "poster", isActive: true };
const edition = (id: string, cover: string | null) => ({
  id,
  workId: "w1",
  title: "Augustus",
  coverS3Key: cover,
  thumbnailS3Key: cover,
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

beforeEach(() => {
  cards.books = new Map([["w1", { id: "w1", title: "Augustus", editions: [edition("e0", "covers/e0.jpg")], media: [poster] }]]);
  cards.editions = new Map([
    ["own", edition("own", "covers/own.jpg")],
    ["follows", edition("follows", null)],
  ]);
});

describe("an edition's card on a related shelf", () => {
  it("shows the book's cover when the edition follows it", async () => {
    const [group] = await relatedGroupsFrom([row("follows")]);
    const [card] = group.works;
    expect(card.editions.map((e) => e.id)).toEqual(["follows"]);
    expect(card.media).toEqual([poster]);
    expect(card.editionNote).toBe("Augustus · 2014 edition · Published by New York Review Books");
  });

  it("shows its own cover over the book's when it has one", async () => {
    const [group] = await relatedGroupsFrom([row("own")]);
    expect(group.works[0].media).toEqual([]);
    expect(group.works[0].editions[0].coverS3Key).toBe("covers/own.jpg");
  });
});
