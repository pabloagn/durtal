import { describe, expect, it } from "vitest";
import {
  collectableNouns,
  collectionCreatedMessage,
  collectionDeletedMessage,
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
