import { describe, expect, it } from "vitest";
import { indexCatalogue } from "@/lib/ebooks/match/catalogue";
import { scorePair } from "@/lib/ebooks/match/score";
import { matchInMemory, matchOne } from "@/lib/ebooks/match/tiers";
import { probabilityForBits } from "@/lib/ebooks/match/model";
import { matchFingerprint } from "@/lib/ebooks/match/keys";
import { author, catalogue, ebook, edition, work } from "./fixtures";

describe("scores and review tiers", () => {
  it("makes an exact identifier/title/author match and identifies an ISBN-10-only edition", () => {
    const cat = catalogue({
      works: [work({ editions: [edition({ isbn10: "0306406152" })] })],
    });
    const result = matchOne(ebook({ isbns: ["9780306406157"] }), cat);
    expect(result).toMatchObject({ tier: "exact", autoLink: true });
    expect(result.candidates[0].effect).toMatchObject({
      rule: "isbn_edition",
      editionId: "edition-1",
    });
  });
  it("recognises an external edition id while not inventing an edition for a work id", () => {
    const cat = catalogue({
      works: [
        work({ editions: [edition({ identifiers: { google: ["id"] } })] }),
      ],
    });
    expect(matchOne(ebook({ identifiers: { google: ["id"] } }), cat).tier).toBe(
      "exact",
    );
    const workCat = catalogue({
      works: [work({ identifiers: { openlibrary: ["OL1W"] } })],
    });
    const result = matchOne(
      ebook({ identifiers: { openlibrary: ["OL1W"] } }),
      workCat,
    );
    expect(result.candidates[0].effect.rule).toBe("new_edition");
  });
  it("scores exact title/author as strong and a different author below the candidate threshold", () => {
    expect(matchOne(ebook(), catalogue())).toMatchObject({
      tier: "strong",
      autoLink: true,
    });
    expect(
      matchOne(ebook({ authors: ["James Joyce"] }), catalogue()),
    ).toMatchObject({ tier: "not_in_durtal", autoLink: false, candidates: [] });
  });
  it("keeps possible translations under same author without choosing a bibliographic edition", () => {
    expect(
      matchOne(
        ebook({ title: "Against the Grain", authors: ["J.-K. Huysmans"] }),
        catalogue({
          works: [
            work({
              title: "À rebours",
              authors: [author({ name: "Joris-Karl Huysmans" })],
              originalLanguage: "fr",
            }),
          ],
        }),
      ),
    ).toMatchObject({ tier: "same_author", autoLink: false });
  });
  it("classifies similar and partial titles using their measured similarity", () => {
    const cat = catalogue({
      works: [work({ title: "Collected Literary Essays" })],
    });
    const similar = matchOne(ebook({ title: "Collected Literary Essay" }), cat);
    expect(similar.candidates[0].titleSimilarity).toBeGreaterThanOrEqual(0.8);
    expect(similar.tier).toBe("likely");
    const partial = matchOne(
      ebook({ title: "Collected Literary Letters" }),
      cat,
    );
    expect(partial.candidates[0].titleSimilarity).toBeGreaterThanOrEqual(0.5);
    expect(partial.candidates[0].titleSimilarity).toBeLessThan(0.8);
    expect(partial.tier).toBe("to_choose");
  });
  it("routes an identifying ISBN with another title and author to conflict", () => {
    const cat = catalogue({
      works: [work({ editions: [edition({ isbn13: "9780306406157" })] })],
    });
    expect(
      matchOne(
        ebook({
          title: "Ulysses",
          authors: ["James Joyce"],
          isbns: ["9780306406157"],
        }),
        cat,
      ),
    ).toMatchObject({ tier: "conflict", autoLink: false });
  });
  it("refuses conflicting identifier owners and known author disagreement even when one title agrees", () => {
    const cat = catalogue({
      works: [
        work({ editions: [edition({ isbn13: "9780306406157" })] }),
        work({
          id: "other",
          title: "Fictions",
          editions: [
            edition({
              id: "other-edition",
              workId: "other",
              identifiers: { google: ["other-id"] },
            }),
          ],
        }),
      ],
    });
    expect(
      matchOne(
        ebook({
          isbns: ["9780306406157"],
          identifiers: { google: ["other-id"] },
        }),
        cat,
      ),
    ).toMatchObject({ tier: "conflict", autoLink: false });
    const result = matchOne(
      ebook({ isbns: ["9780306406157"], authors: ["James Joyce"] }),
      cat,
    );
    expect(result.autoLink).toBe(false);
    expect(result.candidates[0].vetoes.map((reason) => reason.code)).toContain(
      "author_disagrees",
    );
  });
  it("drops shared ISBN weight and never calls its ebooks duplicates based on the shared number", () => {
    const ebooks = [
      ebook({ title: "Nadja", isbns: ["9780306406157"] }),
      ebook({ id: "ebook-2", title: "Ulysses", isbns: ["9780306406157"] }),
      ebook({ id: "ebook-3", title: "Fictions", isbns: ["9780306406157"] }),
    ];
    const cat = catalogue({ ebooks });
    expect(cat.sharedIsbns.has("9780306406157")).toBe(true);
    const result = matchOne(ebooks[0], cat);
    expect(result).toMatchObject({ tier: "conflict", autoLink: false });
    expect(result.candidates[0].components.identifier).toBe(0);
  });
  it("requires a margin even for identifier matches and never breaks a tie into an automatic decision", () => {
    const cat = catalogue({ works: [work(), work({ id: "work-2" })] });
    const result = matchOne(ebook(), cat);
    expect(result).toMatchObject({ tier: "likely", autoLink: false });
    expect(result.candidates[0].marginBits).toBe(0);
  });
  it.each([
    {
      book: work({ title: "Nadja Vol. 3" }),
      file: ebook({ title: "Nadja Vol. 2" }),
      code: "number_signature",
    },
    {
      book: work({ series: ["Sequence"], seriesPosition: "3" }),
      file: ebook({ series: "Sequence", seriesIndex: 2 }),
      code: "series_position",
    },
    {
      book: work({ originalYear: 1928 }),
      file: ebook({ publishedYear: 1926 }),
      code: "year",
    },
  ])("vetoes $code even with a matching identifier", ({ book, file, code }) => {
    const cat = catalogue({
      works: [
        {
          ...book,
          editions: [edition({ title: book.title, isbn13: "9780306406157" })],
        },
      ],
    });
    const result = matchOne({ ...file, isbns: ["9780306406157"] }, cat);
    expect(result.autoLink).toBe(false);
    expect(result.candidates[0].vetoes.map((reason) => reason.code)).toContain(
      code,
    );
  });
  it("keeps flags out of automatic paths and classifies samples as non-books", () => {
    const sample = matchOne(
      ebook({ title: "Nadja sample", isbns: ["9780306406157"] }),
      catalogue({
        works: [work({ editions: [edition({ isbn13: "9780306406157" })] })],
      }),
    );
    expect(sample).toMatchObject({ tier: "not_a_book", autoLink: false });
    expect(
      matchOne(ebook({ title: "Nadja & Other Stories" }), catalogue()).autoLink,
    ).toBe(false);
  });
  it("retains removed volume numbers as veto evidence and detects two catalogued titles in an omnibus", () => {
    const cat = catalogue({
      works: [
        work({
          title: "Nadja (Book 3)",
          editions: [
            edition({ title: "Nadja (Book 3)", isbn13: "9780306406157" }),
          ],
        }),
      ],
    });
    const result = matchOne(
      ebook({ title: "Nadja (Book 2)", isbns: ["9780306406157"] }),
      cat,
    );
    expect(result.autoLink).toBe(false);
    expect(result.candidates[0].vetoes.map((reason) => reason.code)).toContain(
      "number_signature",
    );
    const omnibus = matchOne(
      ebook({ title: "Nadja The Cathedral" }),
      catalogue({
        works: [work(), work({ id: "second", title: "The Cathedral" })],
      }),
    );
    expect(omnibus.flags).toContain("omnibus");
    expect(omnibus.autoLink).toBe(false);
  });
  it("explains an empty catalogue and non-book or shared-ISBN results without candidates", () => {
    expect(matchOne(ebook(), catalogue({ works: [] })).reasons[0].code).toBe(
      "not_in_durtal",
    );
    expect(
      matchOne(ebook({ title: "Nadja preview" }), catalogue({ works: [] })),
    ).toMatchObject({ tier: "not_a_book", flags: ["sample"] });
    const ebooks = ["Nadja", "Fictions", "Ulysses"].map((title, i) =>
      ebook({ id: `ebook-${i}`, title, isbns: ["9780306406157"] }),
    );
    const result = matchOne(ebooks[0], catalogue({ ebooks, works: [] }));
    expect(result).toMatchObject({
      tier: "conflict",
      flags: ["shared_isbn"],
      candidates: [],
    });
    expect(result.reasons[0].code).toBe("conflict");
  });
  it("reduces Poems across three different authors, but not three copies by one author", () => {
    const sources = ["Anna Vale", "Bela Rowan", "Clara Reed"].map((name, i) =>
      ebook({ id: `ebook-${i}`, title: "Poems", authors: [name] }),
    );
    const cat = catalogue({
      ebooks: sources,
      works: [
        work({ title: "Poems", authors: [author({ name: "Anna Vale" })] }),
      ],
    });
    expect(scorePair(sources[0], cat.works[0], cat).components.title).toBe(7.6);
    expect(
      catalogue({
        ebooks: sources.map((item) => ({ ...item, authors: ["Anna Vale"] })),
        works: [
          work({ title: "Poems", authors: [author({ name: "Anna Vale" })] }),
        ],
        authors: [author({ name: "Anna Vale" })],
      }).commonTitles.has("poems"),
    ).toBe(false);
  });
  it("ignores placeholder English as positive language evidence", () => {
    const cat = catalogue({
      works: [
        work({
          originalLanguage: "fr",
          editions: [edition({ metadataSource: "phantom_canon" })],
        }),
      ],
    });
    expect(scorePair(ebook(), cat.works[0], cat).components.language).toBe(
      -1.7,
    );
  });
  it("keeps linked and unchanged decisions; rematches changed decided metadata only when requested", () => {
    const file = ebook();
    expect(matchOne({ ...file, instanceId: "copy" }, catalogue()).skipped).toBe(
      "linked",
    );
    const decided = {
      ...file,
      matchState: "standalone" as const,
      matchFingerprint: matchFingerprint(file),
    };
    expect(matchOne(decided, catalogue(), { rematch: true }).skipped).toBe(
      "unchanged_decision",
    );
    expect(matchOne({ ...decided, title: "Other" }, catalogue()).skipped).toBe(
      "unchanged_decision",
    );
    expect(
      matchOne({ ...decided, title: "Other" }, catalogue(), { rematch: true })
        .skipped,
    ).toBeNull();
  });
  it("returns reproducible top-three candidates without mutating reordered inputs", () => {
    const sources = [
      work(),
      work({ id: "work-2" }),
      work({ id: "work-3" }),
      work({ id: "work-4" }),
    ];
    const cat = catalogue({ works: sources });
    const reordered = indexCatalogue({
      ...cat.source,
      works: [...sources].reverse(),
    });
    expect(matchInMemory([ebook()], cat)).toEqual(
      matchInMemory([ebook()], reordered),
    );
    expect(
      matchOne(ebook(), cat).candidates.map((candidate) => candidate.workId),
    ).toEqual(["work-1", "work-2", "work-3"]);
    expect(sources.map((item) => item.id)).toEqual([
      "work-1",
      "work-2",
      "work-3",
      "work-4",
    ]);
  });
  it("keeps probability finite for extreme weights", () => {
    expect(probabilityForBits(2000)).toBe(1);
    expect(probabilityForBits(-2000)).toBe(0);
    expect(probabilityForBits(0)).toBe(0.5);
  });
});
