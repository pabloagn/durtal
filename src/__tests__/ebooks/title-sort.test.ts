import { describe, expect, it } from "vitest";
import { ebookTitleSort } from "@/lib/ebooks/title-sort";

describe("ebook natural title key", () => {
  it.each([
    ["The Waves", "en", "waves"],
    ["Les Misérables", "fr", "miserables"],
    ["L’Étranger", "fra", "etranger"],
    ["El Aleph", "es", "aleph"],
    ["Die Verwandlung", "de", "verwandlung"],
    ["Il nome della rosa", "it", "nome della rosa"],
    ["Os Lusíadas", "pt", "lusiadas"],
    ["Het verdriet van België", "nl", "verdriet van belgie"],
  ])("sorts %s in its declared language", (title, language, expected) => {
    expect(ebookTitleSort(title, language)).toBe(expected);
  });
  it("removes one article and never borrows another language's article list", () => {
    expect(ebookTitleSort("The The", "en-US")).toBe("the");
    expect(ebookTitleSort("Die Hard", "en")).toBe("die hard");
    expect(ebookTitleSort("The Waves", null)).toBe("the waves");
    expect(ebookTitleSort("The Waves", "und")).toBe("the waves");
    expect(ebookTitleSort("The", "en")).toBe("the");
  });
  it("pads every numeric run to six digits without truncating longer runs", () => {
    expect(ebookTitleSort("Book 2 · Volume 10", "en")).toBe(
      "book 000002 volume 000010",
    );
    expect(
      ebookTitleSort("Book 2", "en") < ebookTitleSort("Book 10", "en"),
    ).toBe(true);
    expect(ebookTitleSort("Book 1234567", "en")).toBe("book 1234567");
  });
  it("normalizes accents, case, punctuation and whitespace", () => {
    expect(ebookTitleSort("  À REBOURS — 2  ", "fr")).toBe("a rebours 000002");
    expect(ebookTitleSort("", null)).toBe("");
  });
});
