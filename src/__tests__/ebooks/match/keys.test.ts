import { describe, expect, it, vi } from "vitest";
import {
  authorAgreement,
  authorKey,
  canonicalIsbn,
  ebookFlags,
  identifierKeys,
  matchFingerprint,
  titleKeys,
} from "@/lib/ebooks/match/keys";
import {
  strictWordSimilarity,
  wordTrigrams,
} from "@/lib/ebooks/match/similarity";
import { ebook } from "./fixtures";

vi.mock("@/lib/db", () => {
  throw new Error("Pure matching must never import the database");
});
describe("bibliographic keys", () => {
  it.each([
    ["en", "The Waves", "waves"],
    ["fr", "Les Misérables", "miserables"],
    ["es", "El Aleph", "aleph"],
    ["de", "Die Verwandlung", "verwandlung"],
    ["it", "Il Nome", "nome"],
    ["pt", "Os Maias", "maias"],
    ["nl", "Het Boek", "boek"],
  ])(
    "removes one %s article while retaining the full title",
    (language, title, key) => {
      expect(titleKeys(title, null, language).all).toContain(key);
      expect(titleKeys(title, null, language).full).not.toBe(key);
    },
  );
  it("keeps Die Hard, À rebours, apostrophe articles and unknown-language alternatives", () => {
    expect(titleKeys("Die Hard", null, "en").all).toEqual(["die hard"]);
    expect(titleKeys("À rebours", null, "fr").all).toEqual(["a rebours"]);
    expect(titleKeys("L’Étranger", null, "fr").all).toContain("etranger");
    expect(titleKeys("Die Hard").all).toContain("die hard");
  });
  it("splits subtitles and records removed series positions without removing unknown brackets", () => {
    expect(
      titleKeys("Nadja: A Novel [EPUB] (Book 2) (z-lib.org)", null, "en"),
    ).toMatchObject({
      main: "nadja",
      full: "nadja a novel",
      removedSeriesPosition: "2",
    });
    expect(titleKeys("Nadja — A Novel").main).toBe("nadja");
    expect(titleKeys("Nadja (Author's cut)").cleaned).toContain("Author's cut");
  });
  it.each([
    "unknown",
    "various",
    "anonymous",
    "uncredited",
    "inconnu",
    "desconocido",
    "autor desconocido",
    "",
  ])("treats %s as missing author evidence", (name) =>
    expect(authorKey(name)).toBeNull(),
  );
  it("matches full identities, initials and transliterations without merging full names sharing initials", () => {
    const compare = (a: string, b: string) =>
      authorAgreement([authorKey(a)!], [authorKey(b)!]);
    expect(compare("Borges, Jorge Luis", "Jorge Luis Borges")).toBe("identity");
    expect(compare("J. L. Borges", "Jorge Luis Borges")).toBe("compatible");
    expect(compare("John Smith", "James Smith")).toBe("disagree");
    expect(compare("Fyodor Dostoevsky", "Fyodor Dostoïevski")).toBe(
      "compatible",
    );
    expect(compare("Fyodor Dostoevsky", "Fyodor Dostojewski")).toBe(
      "compatible",
    );
    expect(authorKey("Simone de Beauvoir")?.surname).toBe("de beauvoir");
    expect(authorAgreement([], [authorKey("Andre Breton")!])).toBe("missing");
  });
  it("canonicalises full ISBN checksums and namespaces external ids", () => {
    expect(canonicalIsbn("0-306-40615-2")).toBe("9780306406157");
    expect(canonicalIsbn("9780306406158")).toBeNull();
    expect(canonicalIsbn("978030640615")).toBeNull();
    expect(
      identifierKeys([], {
        asin: ["0306406152", "b012345678", "invalid"],
        google: ["B012345678"],
      }),
    ).toEqual({
      isbns: ["9780306406157"],
      external: ["asin:B012345678", "google:B012345678"],
    });
  });
  it.each([
    ["Collected Works 1-3", "omnibus"],
    ["Nadja / The Cathedral", "omnibus"],
    ["Œuvres complètes", "omnibus"],
    ["Nadja preview", "sample"],
    ["Review issue 42", "periodical"],
  ])("flags %s", (title, flag) =>
    expect(ebookFlags(ebook({ title }))).toContain(flag),
  );
  it("flags DOI articles without treating the novel 1984 as a periodical", () => {
    expect(
      ebookFlags(ebook({ identifiers: { doi: ["10.1000/42"] } })),
    ).toContain("article");
    expect(ebookFlags(ebook({ title: "1984" }))).not.toContain("periodical");
  });
  it("fingerprints normalised metadata and bytes, independently of decisions, timestamps and order", () => {
    const a = ebook({
      authors: ["André Breton", "Paul Éluard"],
      identifiers: { google: ["z", "a"] },
    });
    const b = ebook({
      title: "NADJA",
      language: "eng",
      authors: ["Paul Eluard", "Andre Breton"],
      identifiers: { google: ["a", "z"] },
      matchState: "excluded",
      exclusionReason: "other",
      updatedAt: "2026-10-10T00:00:00Z",
    });
    expect(matchFingerprint(a)).toBe(matchFingerprint(b));
    expect(matchFingerprint(a)).not.toBe(
      matchFingerprint({
        ...a,
        files: [{ ...a.files[0], sha256: "b".repeat(64) }],
      }),
    );
  });
});
describe("strict word trigrams", () => {
  it("pads whole words, ignores duplicate trigrams and respects word boundaries", () => {
    expect([...wordTrigrams("cat")[0]]).toEqual(["  c", " ca", "cat", "at "]);
    expect(strictWordSimilarity("cat", "the cat sleeps")).toBe(1);
    expect(strictWordSimilarity("cat", "cats")).toBeCloseTo(0.5);
    expect(strictWordSimilarity("cat", "cat cat")).toBe(1);
    expect(strictWordSimilarity("", "cat")).toBe(0);
    expect(strictWordSimilarity("cat", "")).toBe(0);
    expect(strictWordSimilarity("cat", "concatenate")).toBeLessThan(0.3);
    expect(strictWordSimilarity("日本", "日本 語")).toBe(1);
  });
});
