import { describe, expect, it } from "vitest";
import {
  collectableNouns,
  collectionCreatedMessage,
  collectionDeletedMessage,
  collectionMembersNoun,
  worksNoun,
} from "@/lib/collections/counts";

describe("what a collection's works are called (SLN-545)", () => {
  it("names works of one kind by that kind", () => {
    expect(worksNoun(["perfume"])).toBe("perfume");
    expect(worksNoun(["film", "film"])).toBe("films");
    expect(worksNoun(["painting"])).toBe("painting");
    expect(worksNoun(["book", "book", "book"])).toBe("books");
  });

  it("calls works of more than one kind items, as the collection counts do", () => {
    expect(worksNoun(["book", "film"])).toBe("items");
    expect(worksNoun([])).toBe("items");
  });

  it("says what a new collection took", () => {
    expect(collectionCreatedMessage(["perfume"])).toBe("Collection created with this perfume");
    expect(collectionCreatedMessage(["book", "book"])).toBe("Collection created with these 2 books");
    expect(collectionCreatedMessage(["film", "painting", "book"])).toBe("Collection created with these 3 items");
  });

  it("says what stays in the library when a collection is deleted", () => {
    expect(collectionDeletedMessage(["painting"])).toBe("Collection deleted. Its painting stays in your library.");
    expect(collectionDeletedMessage(["film", "film"])).toBe("Collection deleted. Its films stay in your library.");
    expect(collectionDeletedMessage(["book", "perfume"])).toBe("Collection deleted. Its items stay in your library.");
    expect(collectionDeletedMessage([])).toBe("Collection deleted");
  });

  it("lists every kind a collection can hold", () => {
    expect(collectableNouns()).toBe("books, perfumes, films and paintings");
  });
});

// The pager names a collection's members as its count line does (SLN-886)
describe("what a collection's pager calls its members", () => {
  const book = (workId: string) => ({ workId, work: { kind: "book" as const } });
  const edition = (workId: string) => ({ edition: { workId } });
  it("names one card each: books, editions, a kind, else items", () => {
    expect(collectionMembersNoun({ collectionWorks: [book("a"), book("b"), book("c")] })).toBe("books");
    // A book held both ways shows once, as its edition: one card, one book
    expect(collectionMembersNoun({ collectionEditions: [edition("a")], collectionWorks: [book("a")] })).toBe("books");
    expect(collectionMembersNoun({ collectionEditions: [edition("a")], collectionWorks: [book("b")] })).toBe("books");
    // Two editions of one book are two cards (SLN-915)
    expect(collectionMembersNoun({ collectionEditions: [edition("a"), edition("a")] })).toBe("editions");
    expect(collectionMembersNoun({ collectionEditions: [edition("a"), edition("a")], collectionWorks: [book("b")] })).toBe("items");
    expect(collectionMembersNoun({ collectionWorks: [{ workId: "f", work: { kind: "film" as const } }] })).toBe("films");
    expect(collectionMembersNoun({ collectionWorks: [book("a"), { workId: "f", work: { kind: "film" as const } }] })).toBe("items");
    expect(collectionMembersNoun({})).toBe("items");
  });
});
