import { describe, expect, it } from "vitest";
import {
  candidateFormat,
  isPlaceholderEdition,
  rankCandidates,
  type IdentifyContext,
  type RawCandidate,
} from "@/lib/match/identify";

const raw = (c: Partial<RawCandidate>): RawCandidate => ({
  title: "The Loser",
  subtitle: null,
  publisher: "Vintage Books",
  isbn13: "9781400077540",
  isbn10: null,
  publicationYear: 2006,
  pageCount: 189,
  language: "en",
  binding: "paperback",
  description: null,
  coverUrl: "https://images.example/1.jpg",
  authors: ["Bernhard, Thomas"],
  bindingText: "Paperback",
  ...c,
});
const context: IdentifyContext = {
  workTitle: "The Loser",
  authors: ["Thomas Bernhard"],
  language: "en",
  digitalCopies: false,
  owned: new Map(),
};

describe("placeholders", () => {
  it("are the editions of the old import", () => {
    expect(isPlaceholderEdition({ metadataSource: "phantom_canon" })).toBe(true);
    expect(isPlaceholderEdition({ metadataSource: "manual" })).toBe(false);
    expect(isPlaceholderEdition({ metadataSource: null })).toBe(false);
  });
});

describe("formats", () => {
  it.each([
    ["Paperback", "print"],
    ["Kindle Edition", "ebook"],
    ["Audio CD", "audio"],
    ["Unknown Binding", "unknown"],
    [null, "unknown"],
  ])("%s → %s", (text, format) => {
    expect(candidateFormat(text)).toBe(format);
  });
});

describe("ranking", () => {
  it("drops results without a valid ISBN, other books and duplicates", () => {
    const ranked = rankCandidates(
      [
        raw({}),
        raw({ isbn13: "9781400077541" }), // bad check digit
        raw({ title: "Woodcutters", authors: ["Someone Else"], isbn13: "9780226043883" }),
        raw({ isbn13: null, isbn10: "1400077540" }), // the same book again
      ],
      context,
    );
    expect(ranked.map((c) => c.isbn13)).toEqual(["9781400077540"]);
  });

  it("keeps another title by the same author, with a note", () => {
    const [c] = rankCandidates(
      [raw({ title: "Der Untergeher", language: "de" })],
      context,
    );
    expect(c.notes).toEqual(["Another title", "Another language"]);
  });

  it("puts print editions in the book's language with a cover first", () => {
    const ranked = rankCandidates(
      [
        raw({ isbn13: "9780571289219", bindingText: "Kindle Edition", binding: null }),
        raw({ isbn13: "9780226043883", language: "de" }),
        raw({ isbn13: "9780679400875", coverUrl: null }),
        raw({}),
      ],
      context,
    );
    expect(ranked.map((c) => c.isbn13)).toEqual([
      "9781400077540",
      "9780679400875",
      "9780226043883",
      "9780571289219",
    ]);
    expect(ranked.at(-1)?.notes).toContain("E-book");
  });

  it("puts e-books first when every copy is digital", () => {
    const ranked = rankCandidates(
      [raw({}), raw({ isbn13: "9780571289219", bindingText: "Kindle Edition", binding: null })],
      { ...context, digitalCopies: true },
    );
    expect(ranked[0].isbn13).toBe("9780571289219");
  });

  it("puts editions of the house the reader set first, and flags the others", () => {
    const ranked = rankCandidates(
      [
        raw({ isbn13: "9780374100148", house: "other" }),
        raw({ isbn13: "9780099766315", house: "same" }),
      ],
      { ...context, houseName: "Vintage" },
    );
    expect(ranked.map((c) => c.isbn13)).toEqual(["9780099766315", "9780374100148"]);
    expect(ranked[1].notes).toContain("Not Vintage");
  });

  it("leaves out ISBNs another edition holds", () => {
    const owned = new Map([["9781400077540", { title: "The Loser", sameWork: true }]]);
    expect(rankCandidates([raw({})], { ...context, owned })).toEqual([]);
  });
});
