import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { collectionCountLine } from "@/lib/collections/counts";

// SLN-781: the collections index said "6 items" or "0 editions" while a
// collection's page said "4 books · 4 editions" or "Nothing yet". One line
// now serves both

const edition = (workId: string) => ({ edition: { workId } });
const work = (workId: string, kind: "book" | "film" | "perfume" | "painting" = "book") => ({ workId, work: { kind } });

describe("a collection's count line", () => {
  it("names each kind it holds", () => {
    expect(collectionCountLine({ collectionWorks: ["a", "b", "c", "d", "e", "f"].map((id) => work(id)) })).toBe("6 books");
    expect(collectionCountLine({ collectionEditions: ["a", "b", "c", "d"].map(edition) })).toBe("4 books");
    expect(collectionCountLine({ collectionWorks: [work("a"), work("b"), work("c"), work("p", "perfume")] })).toBe("3 books · 1 perfume");
    expect(collectionCountLine({ collectionEditions: [edition("a")], collectionWorks: [work("f", "film"), work("g", "painting"), work("h", "painting")] })).toBe("1 book · 1 film · 2 paintings");
  });

  it("writes thousands with a comma", () => {
    const films = Array.from({ length: 1050 }, (_, i) => work(`f${i}`, "film"));
    expect(collectionCountLine({ collectionWorks: [...films, work("b")] })).toBe("1 book · 1,050 films");
  });

  it("counts a book held both ways once, as its edition", () => {
    expect(collectionCountLine({ collectionEditions: [edition("a")], collectionWorks: [work("a")] })).toBe("1 book");
  });

  // SLN-915: "1 book · 6 editions · 2 films · 1 perfume · 1 of 5 books read"
  it("counts each book once, held whole or through editions, and says when editions outnumber them", () => {
    const decadents = {
      collectionEditions: [edition("a"), edition("a"), edition("a"), edition("b"), edition("c"), edition("d")],
      collectionWorks: [work("e"), work("f1", "film"), work("f2", "film"), work("p", "perfume")],
    };
    expect(collectionCountLine(decadents)).toBe("5 books (6 editions) · 2 films · 1 perfume");
    expect(collectionCountLine({ collectionEditions: [edition("a"), edition("a")] })).toBe("1 book (2 editions)");
  });

  it("is empty for an empty collection", () => {
    expect(collectionCountLine({ collectionEditions: [], collectionWorks: [] })).toBeNull();
  });

  const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

  it("is the line on the card, the mosaic, the add dialog and the page", () => {
    expect(source("components/collections/collection-card.tsx")).toContain('collectionCountLine(collection) ?? "Empty"');
    expect(source("components/collections/collections-view.tsx")).toContain('collectionCountLine(collection) ?? "Empty"');
    expect(source("components/books/add-to-collection-dialog.tsx")).toContain('collectionCountLine(c) ?? "Empty"');
    expect(source("app/(catalogue)/collections/[id]/page.tsx")).toContain("const line = collectionCountLine(collection);");
    // the lists count in SQL, by kind, never by loading the members (SLN-1058)
    expect(source("lib/actions/collections.ts")).toContain("extras: { tally: collectionTallySql().as(\"tally\") }");
    expect(source("lib/actions/collections.ts")).not.toContain("memberSummary");
  });
});
