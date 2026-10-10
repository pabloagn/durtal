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
  it("encodes each integer with a bounded length prefix and at least six value digits", () => {
    expect(ebookTitleSort("Book 2 · Volume 10", "en")).toBe(
      "book 0000000001:000002 volume 0000000002:000010",
    );
    expect(
      ebookTitleSort("Book 2", "en") < ebookTitleSort("Book 10", "en"),
    ).toBe(true);
    expect(ebookTitleSort("Book 1234567", "en")).toBe(
      "book 0000000007:1234567",
    );
  });
  it("orders across six digits, digit-count boundaries and integers beyond Number precision", () => {
    const numbers = [
      "0",
      "1",
      "2",
      "10",
      "999999",
      "1000000",
      "9999999",
      "10000000",
      "9007199254740992",
      "9007199254740993",
      "1" + "0".repeat(120),
    ];
    const titles = numbers.map((number) => `Book ${number}`);
    const ordered = [...titles].reverse().sort((a, b) => {
      const left = ebookTitleSort(a, "en");
      const right = ebookTitleSort(b, "en");
      return left < right ? -1 : left > right ? 1 : 0;
    });
    expect(ordered).toEqual(titles);
  });
  it("gives leading-zero spellings equal keys so the query's ID tie-breaker is authoritative", () => {
    for (const number of ["0", "2", "1000000", "9007199254740993"]) {
      expect(ebookTitleSort(`Book ${"0".repeat(120)}${number}`, "en")).toBe(
        ebookTitleSort(`Book ${number}`, "en"),
      );
    }
  });
  it("keeps numeric ordering independent of case, accents and regional language tags", () => {
    expect(ebookTitleSort("THE BÓOK 0001000000", "en-US")).toBe(
      ebookTitleSort("the book 1000000", "eng"),
    );
    expect(ebookTitleSort("OS LIVROS 0000002", "pt-BR")).toBe(
      ebookTitleSort("os livros 2", "pt"),
    );
    expect(
      ebookTitleSort("Les tomes 999999", "fr-FR") <
        ebookTitleSort("LES TOMES 1000000", "fra"),
    ).toBe(true);
  });
  it("orders each token independently in titles containing multiple numbers", () => {
    expect(
      ebookTitleSort("Book 2 Volume 999999", "en") <
        ebookTitleSort("Book 2 Volume 1000000", "en"),
    ).toBe(true);
    expect(
      ebookTitleSort("Book 2 Volume 1000000", "en") <
        ebookTitleSort("Book 10 Volume 1", "en"),
    ).toBe(true);
  });
  it("normalizes accents, case, punctuation and whitespace", () => {
    expect(ebookTitleSort("  À REBOURS — 2  ", "fr")).toBe(
      "a rebours 0000000001:000002",
    );
    expect(ebookTitleSort("", null)).toBe("");
  });
});
