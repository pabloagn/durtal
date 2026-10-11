import { describe, expect, it } from "vitest";
import {
  accessionEffectLine,
  bulkEffectLine,
  linkEffectLine,
  type LinkSentenceEffect,
  type ReviewEffectCounts,
} from "@/lib/ebooks/review/effect-line";

const effect: LinkSentenceEffect = {
  ready: true,
  missing: [],
  ambiguities: [],
  rule: "fill_copy",
  editionId: "edition-1",
  instanceId: "copy-1",
  movedFromEditionId: null,
  newEdition: null,
  newCopy: null,
};
const context = {
  workTitle: "Nadja",
  edition: {
    id: "edition-1",
    language: "es",
    isbn13: "9780306406157",
    placeholder: true,
  },
};
const zero: ReviewEffectCounts = {
  ebooks: 0,
  filledCopies: 0,
  movedCopies: 0,
  editions: 0,
  copies: 0,
  books: 0,
  authors: 0,
  works: 0,
};
describe("what will be written", () => {
  it("describes filling the seed placeholder without adding rows", () => {
    expect(linkEffectLine(effect, context)).toBe(
      "Fills the digital copy of Nadja (edition not identified)",
    );
  });
  it("describes moving and filling the identified edition", () => {
    expect(
      linkEffectLine(
        { ...effect, rule: "isbn_edition", movedFromEditionId: "placeholder" },
        { ...context, edition: { ...context.edition, placeholder: false } },
      ),
    ).toBe(
      "Moves the digital copy of Nadja to the Spanish edition · ISBN 9780306406157 and fills it",
    );
  });
  it.each(["isbn_edition", "placeholder_copy"] as const)(
    "describes %s adding only a copy",
    (rule) => {
      expect(
        linkEffectLine(
          { ...effect, rule, instanceId: null, newCopy: {} },
          context,
        ),
      ).toBe("Adds a digital copy of Nadja (edition not identified)");
    },
  );
  it.each(["new_isbn_edition", "new_edition"] as const)(
    "describes %s creating an edition and copy",
    (rule) => {
      const isbn13 = rule === "new_isbn_edition" ? "9780306406157" : null;
      expect(
        linkEffectLine(
          {
            ...effect,
            rule,
            instanceId: null,
            editionId: null,
            newEdition: { language: "es", isbn13 },
            newCopy: {},
          },
          { ...context, edition: null },
        ),
      ).toBe(
        `Adds an edition in Spanish (${isbn13 ? `ISBN ${isbn13}` : "without an ISBN"}) and a digital copy of Nadja`,
      );
    },
  );
  it("reports unresolved choices instead of an executable effect", () => {
    expect(
      linkEffectLine(
        {
          ...effect,
          ready: false,
          missing: ["language"],
          ambiguities: [{ text: "Several free copies; choose one" }],
        },
        context,
      ),
    ).toBe("Needs review: a language; Several free copies; choose one");
  });
  it("refuses mismatched edition context and impossible combinations", () => {
    expect(() =>
      linkEffectLine(effect, {
        ...context,
        edition: { ...context.edition, id: "other" },
      }),
    ).toThrow();
    expect(() => linkEffectLine({ ...effect, newCopy: {} }, context)).toThrow();
    expect(() =>
      linkEffectLine({ ...effect, movedFromEditionId: "placeholder" }, context),
    ).toThrow();
    expect(() =>
      linkEffectLine(
        { ...effect, rule: "new_edition", instanceId: null, editionId: null },
        { ...context, edition: null },
      ),
    ).toThrow();
  });
  it("names new and reused authors supplied by the accession planner", () => {
    const accession = {
      ready: true,
      missing: [],
      ambiguities: [],
      work: { title: "Loco afán" },
      edition: {},
      copy: {},
      authors: [
        { name: "Pedro Lemebel", existingId: null, createKey: "pedro" },
        { name: "Jorge Luis Borges", existingId: "borges", createKey: null },
      ],
    };
    expect(accessionEffectLine(accession)).toBe(
      "Creates the book Loco afán, its edition and a digital copy · new author: Pedro Lemebel · author: Jorge Luis Borges, already in Durtal",
    );
    expect(() => accessionEffectLine({ ...accession, authors: [] })).toThrow();
    expect(
      accessionEffectLine({
        ...accession,
        ready: false,
        missing: ["author", "language"],
      }),
    ).toBe("Needs review: an author; a language");
  });
  it("aggregates actual effects for the 37 likely links", () => {
    expect(
      bulkEffectLine("accept", {
        ...zero,
        ebooks: 37,
        filledCopies: 21,
        movedCopies: 2,
        editions: 9,
        copies: 16,
      }),
    ).toBe(
      "Accept 37 likely matches · fills 21 copies (2 moved) · adds 9 editions · adds 16 copies",
    );
  });
  it.each([
    [
      "exclude_duplicates",
      { ...zero, ebooks: 74 },
      "Set aside 74 duplicates · hides them; no files deleted",
    ],
    [
      "exclude_not_a_book",
      { ...zero, ebooks: 23 },
      "Set aside 23 · hides them; no files deleted",
    ],
    [
      "keep",
      { ...zero, ebooks: 5673 },
      "Keep 5,673 as eBooks · marks them standalone; nothing is created",
    ],
    [
      "accession",
      { ...zero, ebooks: 12, books: 12, editions: 12, copies: 12, authors: 1 },
      "Creates 12 books · adds 12 editions · adds 12 copies · creates 1 author",
    ],
    [
      "mark_accessioned",
      { ...zero, ebooks: 8, works: 6 },
      "Mark 6 accessioned · records each status change",
    ],
  ] as const)("describes %s accurately", (action, counts, sentence) => {
    expect(bulkEffectLine(action, counts)).toBe(sentence);
  });
  it("refuses misleading bulk totals instead of hiding unadvertised writes", () => {
    for (const counts of [
      { ...zero, ebooks: -1 },
      { ...zero, ebooks: 1.5 },
      { ...zero, ebooks: 1, filledCopies: 1, copies: 1 },
      { ...zero, ebooks: 1, editions: 1 },
    ]) {
      expect(() => bulkEffectLine("accept", counts)).toThrow();
    }
    expect(() =>
      bulkEffectLine("keep", { ...zero, ebooks: 1, copies: 1 }),
    ).toThrow();
    expect(() =>
      bulkEffectLine("accession", {
        ...zero,
        ebooks: 12,
        books: 11,
        copies: 12,
        editions: 12,
      }),
    ).toThrow();
  });
});
