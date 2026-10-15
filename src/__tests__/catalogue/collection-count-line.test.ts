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
    expect(collectionCountLine({ collectionEditions: ["a", "b", "c", "d"].map(edition) })).toBe("4 editions");
    expect(collectionCountLine({ collectionWorks: [work("a"), work("b"), work("c"), work("p", "perfume")] })).toBe("3 books · 1 perfume");
    expect(collectionCountLine({ collectionEditions: [edition("a")], collectionWorks: [work("f", "film"), work("g", "painting"), work("h", "painting")] })).toBe("1 edition · 1 film · 2 paintings");
  });

  it("counts a book held both ways once, as its edition", () => {
    expect(collectionCountLine({ collectionEditions: [edition("a")], collectionWorks: [work("a")] })).toBe("1 edition");
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
    // the list's rows carry each whole work's kind
    expect(source("lib/actions/collections.ts")).toContain("collectionWorks: { columns: { workId: true }, with: { work: { columns: { kind: true } } } }");
  });
});
