import { describe, expect, it } from "vitest";
import {
  accessionBatchEffects,
  accessionEffect,
} from "@/lib/ebooks/match/effects";
import { editionEffect, preferredMatchFile } from "@/lib/ebooks/match/editions";
import { matchOne } from "@/lib/ebooks/match/tiers";
import { author, at, catalogue, copy, ebook, edition, work } from "./fixtures";

describe("edition and copy effects", () => {
  it("fills the seed copy before creating an ISBN edition and leaves catalogue metadata unchanged", () => {
    const book = work({
      editions: [edition({ metadataSource: "phantom_canon" })],
      copies: [copy()],
    });
    const cat = catalogue({ works: [book] });
    const before = JSON.stringify(book);
    const effect = editionEffect(
      ebook({ isbns: ["9780306406157"] }),
      cat.byWorkId.get("work-1")!,
      cat,
    );
    expect(effect).toMatchObject({
      rule: "fill_copy",
      editionId: "edition-1",
      instanceId: "copy-1",
      newEdition: null,
      newCopy: null,
      ready: true,
    });
    expect(effect.text).toContain("Fills the digital copy");
    expect(JSON.stringify(book)).toBe(before);
    expect(book.catalogueStatus).toBe("wanted");
  });
  it("moves only the unique free placeholder copy to an identified edition", () => {
    const cat = catalogue({
      works: [
        work({
          editions: [
            edition({ metadataSource: "phantom_canon" }),
            edition({ id: "identified", isbn13: "9780306406157" }),
          ],
          copies: [copy()],
        }),
      ],
    });
    expect(
      editionEffect(ebook({ isbns: ["9780306406157"] }), cat.works[0], cat),
    ).toMatchObject({
      rule: "isbn_edition",
      editionId: "identified",
      instanceId: "copy-1",
      movedFromEditionId: "edition-1",
      newCopy: null,
    });
  });
  it("adds a copy of an identified edition without rewriting it", () => {
    const cat = catalogue({
      works: [work({ editions: [edition({ isbn13: "9780306406157" })] })],
    });
    expect(
      editionEffect(ebook({ isbns: ["9780306406157"] }), cat.works[0], cat),
    ).toMatchObject({
      rule: "isbn_edition",
      newEdition: null,
      newCopy: { format: "epub", fileSizeBytes: 1000 },
    });
  });
  it.each([
    { isbns: ["9780306406157"], editions: [], rule: "new_isbn_edition" },
    {
      isbns: [],
      editions: [edition({ metadataSource: "phantom_canon" })],
      rule: "placeholder_copy",
    },
    { isbns: [], editions: [], rule: "new_edition" },
  ])("selects $rule in order", ({ isbns, editions, rule }) => {
    const cat = catalogue({ works: [work({ editions })] });
    const effect = editionEffect(ebook({ isbns }), cat.works[0], cat);
    expect(effect.rule).toBe(rule);
    expect(effect.ready).toBe(true);
  });
  it("requires review when two free copies exist, even when only one has compatible language", () => {
    const cat = catalogue({
      works: [
        work({
          editions: [edition(), edition({ id: "fr", language: "fr" })],
          copies: [copy(), copy({ id: "copy-2", editionId: "fr" })],
        }),
      ],
    });
    expect(editionEffect(ebook(), cat.works[0], cat)).toMatchObject({
      ready: false,
      instanceId: null,
      ambiguities: [{ code: "multiple_copies" }],
    });
    expect(matchOne(ebook(), cat).autoLink).toBe(false);
  });
  it("ignores occupied and deaccessioned copies", () => {
    const cat = catalogue({
      works: [
        work({
          editions: [edition()],
          copies: [
            copy({ linkedEbookId: "other" }),
            copy({ id: "disposed", status: "deaccessioned" }),
          ],
        }),
      ],
    });
    expect(editionEffect(ebook(), cat.works[0], cat)).toMatchObject({
      rule: "new_edition",
      instanceId: null,
    });
  });
  it("does not treat incompatible language or unknown language as an English seed copy", () => {
    const cat = catalogue({
      works: [
        work({ editions: [edition({ language: "fr" })], copies: [copy()] }),
      ],
    });
    expect(editionEffect(ebook(), cat.works[0], cat).rule).toBe("new_edition");
    expect(
      editionEffect(ebook({ language: null }), cat.works[0], cat),
    ).toMatchObject({ ready: false, newEdition: null, missing: ["language"] });
  });
  it("never takes a locked edition's copy automatically", () => {
    const cat = catalogue({
      works: [
        work({
          editions: [edition({ metadataLocked: true })],
          copies: [copy()],
        }),
      ],
    });
    expect(
      editionEffect(ebook(), cat.works[0], cat).ambiguities.map(
        (reason) => reason.code,
      ),
    ).toContain("locked_edition");
    expect(matchOne(ebook(), cat).autoLink).toBe(false);
  });
  it("rejects an ISBN held by another work and multiple candidate ISBNs", () => {
    const cat = catalogue({
      works: [
        work(),
        work({
          id: "other",
          editions: [edition({ workId: "other", isbn13: "9780306406157" })],
        }),
      ],
    });
    const effect = editionEffect(
      ebook({ isbns: ["9780306406157"] }),
      cat.byWorkId.get("work-1")!,
      cat,
    );
    expect(effect.ready).toBe(false);
    expect(effect.newEdition?.isbn13).toBeNull();
    const multiple = editionEffect(
      ebook({ isbns: ["9780306406157", "9780141182551"] }),
      catalogue().works[0],
      catalogue(),
    );
    expect(multiple.ambiguities.map((reason) => reason.code)).toContain(
      "multiple_isbns",
    );
  });
  it("requires a verified file and location, and accepts no protected or unvalidated file", () => {
    const file = ebook();
    const noFile = {
      ...file,
      files: [{ ...file.files[0], availability: "blocked" as const }],
    };
    expect(preferredMatchFile(noFile)).toBeNull();
    expect(
      preferredMatchFile({
        ...file,
        files: [{ ...file.files[0], drm: "unknown" }],
      }),
    ).toBeNull();
    const cat = catalogue({ ebookLocationId: null });
    expect(editionEffect(noFile, cat.works[0], cat).missing).toEqual([
      "verified_file",
      "ebook_location",
    ]);
  });
  it("honours a deliverable preferred file, maps KEPUB to EPUB, and copies only validated cover provenance", () => {
    const file = ebook({ coverKey: "unvalidated-cover" });
    const pdf = {
      ...file.files[0],
      id: "pdf",
      format: "pdf",
      coverKey: "validated-cover",
    };
    const cat = catalogue();
    expect(
      editionEffect(
        { ...file, preferredFileId: "pdf", files: [...file.files, pdf] },
        cat.works[0],
        cat,
      ),
    ).toMatchObject({
      newCopy: { format: "pdf" },
      newEdition: { coverSourceKey: "validated-cover" },
    });
    expect(
      editionEffect(file, cat.works[0], cat).newEdition?.coverSourceKey,
    ).toBeNull();
    expect(
      editionEffect(
        { ...file, files: [{ ...file.files[0], format: "kepub" }] },
        cat.works[0],
        cat,
      ).newCopy?.format,
    ).toBe("epub");
  });
  it("refuses malformed cross-work edition and copy snapshots", () => {
    expect(() =>
      catalogue({
        works: [work({ editions: [edition({ workId: "other" })] })],
      }),
    ).toThrow("edition");
    expect(() => catalogue({ works: [work({ copies: [copy()] })] })).toThrow(
      "copy",
    );
  });
});
describe("accession previews", () => {
  it("reuses a catalogue author found through an alias and leaves original year unknown", () => {
    const cat = catalogue({
      authors: [
        author({ name: "Joris-Karl Huysmans", aliases: ["J.-K. Huysmans"] }),
      ],
    });
    const effect = accessionEffect(
      ebook({
        authors: ["J.-K. Huysmans"],
        title: "The Cathedral",
        publishedYear: 2005,
      }),
      cat,
    );
    expect(effect).toMatchObject({
      ready: true,
      authors: [{ existingId: "author-1", createKey: null }],
      work: {
        originalYear: null,
        catalogueStatus: "accessioned",
        originalLanguage: "en",
      },
      edition: { publicationYear: 2005, isbn13: null },
    });
  });
  it("uses natural-order names, reports a new person and does not invent original titles or translators", () => {
    const effect = accessionEffect(
      ebook({ authors: ["Lemebel, Pedro"] }),
      catalogue({ authors: [] }),
    );
    expect(effect.authors[0]).toMatchObject({
      name: "Pedro Lemebel",
      sortName: "Lemebel, Pedro",
      existingId: null,
    });
    expect(effect.text).toContain("new author: Pedro Lemebel");
    expect(effect.work).not.toHaveProperty("originalTitle");
    expect(effect.edition).not.toHaveProperty("contributorIds");
  });
  it("asks for missing author and language, and refuses invalid explicit choices", () => {
    const file = ebook({ authors: ["Unknown"], language: null });
    expect(accessionEffect(file, catalogue())).toMatchObject({
      ready: false,
      missing: ["author", "language"],
    });
    expect(
      accessionEffect(file, catalogue(), {
        authors: [{ id: "author-1" }],
        language: "fr",
      }).ready,
    ).toBe(true);
    expect(
      accessionEffect(file, catalogue(), {
        authors: [{ id: "missing" }],
        language: "und",
      }).ready,
    ).toBe(false);
  });
  it("uses detected language only when accepted files agree", () => {
    const file = ebook({ language: null });
    expect(
      accessionEffect(
        { ...file, files: [{ ...file.files[0], textLanguage: "fr" }] },
        catalogue(),
      ).work?.originalLanguage,
    ).toBe("fr");
    expect(
      accessionEffect(
        {
          ...file,
          files: [
            { ...file.files[0], textLanguage: "fr" },
            { ...file.files[0], id: "other", textLanguage: "es" },
          ],
        },
        catalogue(),
      ).missing,
    ).toContain("language");
  });
  it("requires an explicit person choice for a compatible catalogue name or ambiguous identity", () => {
    const cat = catalogue({ authors: [author({ name: "Jorge Luis Borges" })] });
    expect(
      accessionEffect(ebook({ authors: ["J. L. Borges"] }), cat).ready,
    ).toBe(false);
    expect(
      accessionEffect(ebook({ authors: ["J. L. Borges"] }), cat, {
        authors: [{ id: "author-1" }],
      }).ready,
    ).toBe(true);
    const ambiguous = catalogue({
      authors: [author(), author({ id: "author-2" })],
    });
    expect(accessionEffect(ebook(), ambiguous).ambiguities[0].code).toBe(
      "author_identity",
    );
  });
  it("blocks held ISBN accession until the user chooses no ISBN or links the existing book", () => {
    const cat = catalogue({
      works: [work({ editions: [edition({ isbn13: "9780306406157" })] })],
    });
    expect(
      accessionEffect(ebook({ isbns: ["9780306406157"] }), cat).ready,
    ).toBe(false);
    expect(
      accessionEffect(ebook({ isbns: ["9780306406157"] }), cat, {
        isbn13: null,
      }).ready,
    ).toBe(true);
  });
  it("clusters unambiguous initials/full names once per batch independently of input order", () => {
    const files = [
      ebook({ authors: ["J. L. Borges"] }),
      ebook({ id: "ebook-2", authors: ["Jorge Luis Borges"] }),
    ];
    const cat = catalogue({ authors: [] });
    const results = accessionBatchEffects(files, cat);
    expect(results.map((effect) => effect.authors[0].createKey)).toEqual([
      "author:jorge luis borges",
      "author:jorge luis borges",
    ]);
    expect(results.every((effect) => effect.ready)).toBe(true);
    expect(results[0].text).toContain("new author: Jorge Luis Borges");
    expect(accessionBatchEffects([...files].reverse(), cat)).toEqual(results);
  });
  it("does not merge an ambiguous initial into two different full people", () => {
    const files = [
      ebook({ authors: ["J. Smith"] }),
      ebook({ id: "ebook-2", authors: ["John Smith"] }),
      ebook({ id: "ebook-3", authors: ["James Smith"] }),
    ];
    const results = accessionBatchEffects(files, catalogue({ authors: [] }));
    expect(results[0].ready).toBe(false);
    expect(results[1].authors[0].createKey).not.toBe(
      results[2].authors[0].createKey,
    );
  });
});
describe("duplicate review proposals", () => {
  it("prefers more readable formats then older records, without cycles", () => {
    const old = ebook();
    const newer = ebook({ id: "ebook-2", createdAt: "2026-10-10T00:00:00Z" });
    const cat = catalogue({ ebooks: [old, newer] });
    expect(matchOne(newer, cat)).toMatchObject({
      tier: "duplicate",
      duplicateOfId: old.id,
      autoLink: false,
    });
    expect(matchOne(old, cat).tier).not.toBe("duplicate");
    const more = {
      ...newer,
      files: [...newer.files, { ...newer.files[0], id: "pdf", format: "pdf" }],
    };
    expect(
      matchOne(old, catalogue({ ebooks: [old, more] })).duplicateOfId,
    ).toBe(more.id);
  });
  it("keeps different languages, authors and unknown identities separate", () => {
    for (const fields of [
      { language: "fr" },
      { authors: ["James Joyce"] },
      { authors: [] },
    ]) {
      const first = ebook(fields);
      const next = ebook({ id: "ebook-2", createdAt: at });
      expect(
        matchOne(next, catalogue({ ebooks: [first, next] })).tier,
      ).not.toBe("duplicate");
    }
  });
});
