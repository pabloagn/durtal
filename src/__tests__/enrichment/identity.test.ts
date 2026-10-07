import { describe, expect, it } from "vitest";
import {
  ANSWER,
  ID_PATTERNS,
  isEditionItem,
  normalizeLccn,
  planIdentity,
  type IdentityBook,
  type IdentityEdition,
  type IdentityPlan,
  type WikidataItem,
} from "@/lib/enrichment/identity";
import { readOpenLibraryEdition, readWikidataItem } from "@/lib/enrichment/identity-sources";
import { isbn10To13 } from "@/lib/match/plan";
import { identityReviewSchema } from "@/lib/enrichment/identity-review";
import { KAPUTT_AUTHOR, KAPUTT_HIT, RECORDED, recordedAnswers } from "@/__tests__/fixtures/enrichment/identity/answers";

/*
 * SLN-464: the identity rules on answers the SLN-461 sample recorded (see
 * the fixture's answers.ts for the few that were built). No network.
 */

const edition = (isbn13: string | null, title: string, fields: Partial<IdentityEdition> = {}): IdentityEdition => ({
  id: `edition-${isbn13 ?? title}`,
  title,
  isbn13,
  year: null,
  locked: false,
  ...fields,
});
const book = (title: string, editions: IdentityEdition[], fields: Partial<IdentityBook> = {}): IdentityBook => ({
  workId: `work-${title}`,
  slug: title.toLowerCase().replace(/\W+/g, "-"),
  title,
  authorQids: [],
  authorOpenLibraryIds: [],
  editions,
  known: {},
  knownLccn: {},
  taken: {},
  ...fields,
});
const values = (plan: IdentityPlan) => plan.proposals.map((p) => [p.dimension, p.value, p.confidence]);

describe("identity IDs", () => {
  it("normalises an LCCN by the Library of Congress rules", () => {
    expect(normalizeLccn(" 99036024 ")).toBe("99036024");
    expect(normalizeLccn("2001-12345")).toBe("2001012345");
    expect(normalizeLccn("n78-89035")).toBe("n78089035");
    expect(normalizeLccn("85-2 ")).toBe("85000002");
    expect(normalizeLccn("2001012345/AC/r932")).toBe("2001012345");
    expect(normalizeLccn("not an lccn")).toBeNull();
    expect(normalizeLccn("2001-1234567")).toBeNull();
  });

  it("knows each ID's form, and an edition item", () => {
    expect(ID_PATTERNS.wikidata_qid.test("Q979609")).toBe(true);
    expect(ID_PATTERNS.wikidata_qid.test("Q0")).toBe(false);
    expect(ID_PATTERNS.open_library_work.test("OL157104W")).toBe(true);
    expect(ID_PATTERNS.open_library_work.test("OL28608697M")).toBe(false);
    expect(ID_PATTERNS.oclc_work.test("2197707")).toBe(true);
    expect(ID_PATTERNS.lccn.test("2012045914")).toBe(true);
    const item = (claims: Partial<WikidataItem["claims"]>): WikidataItem => ({
      id: "Q1",
      label: null,
      claims: { P31: [], P50: [], P577: [], P629: [], P648: [], P5331: [], ...claims },
    });
    expect(isEditionItem(item({ P629: ["Q2"] }))).toBe(true);
    expect(isEditionItem(item({ P31: ["Q3331189"] }))).toBe(true);
    expect(isEditionItem(item({ P31: ["Q7725634"] }))).toBe(false);
  });

  it("reads recorded answers into the fields identity uses", () => {
    expect(readOpenLibraryEdition(RECORDED["https://openlibrary.org/isbn/9781590171479.json"])).toEqual({
      key: expect.stringMatching(/^\/books\/OL\d+M$/),
      title: "Kaputt",
      works: [{ key: "/works/OL1272994W" }],
      isbn_13: [],
      isbn_10: ["1590171470"],
      lccn: [],
    });
    expect(readWikidataItem(RECORDED["https://www.wikidata.org/wiki/Q219437"] as never).claims).toMatchObject({
      P50: ["Q297532"],
      P648: ["OL16071085W"],
      P5331: ["119792823"],
    });
  });
});

describe("identity plans on recorded answers", () => {
  const answers = recordedAnswers();

  it("Life and Fate: its Open Library work and its item link each other, so both are exact", () => {
    const plan = planIdentity(book("Life and Fate", [edition("9781784871963", "Life and Fate")], { authorQids: ["Q313767"] }), answers);
    expect(values(plan)).toEqual([
      ["open_library_work", "OL157104W", 1],
      ["wikidata_qid", "Q979609", 1],
    ]);
    expect(plan.result).toBe("resolved");
    expect(plan.found).toMatchObject({ edition: true, work: true, byP648: true, byLink: true, bySearch: false });
  });

  it("Beware of Pity: the exact QID gives its OCLC work ID", () => {
    const plan = planIdentity(book("Beware of Pity", [edition("9780241678763", "Beware of Pity")]), answers);
    expect(values(plan)).toEqual([
      ["open_library_work", "OL28434W", 1],
      ["wikidata_qid", "Q1428590", 1],
      ["oclc_work", "2197707", 1],
    ]);
  });

  it("2666: Wikidata names another Open Library work, so the QID goes to review and its OCLC work ID waits", () => {
    const plan = planIdentity(book("2666", [edition("9780374100148", "2666")]), answers);
    expect(values(plan)).toEqual([
      ["lccn", "2009290464", 1],
      ["open_library_work", "OL712025W", 1],
      ["wikidata_qid", "Q219437", 0.4],
    ]);
    expect(plan.proposals[2].note).toBe("Wikidata links it to another Open Library work, OL16071085W");
    expect(plan.notes).toContain("The OCLC work ID waits for the QID's review");
    expect(plan.result).toBe("review");
  });

  it("House of Leaves: one LCCN is exact, and the record of an ISBN it lists second is still exact", () => {
    const plan = planIdentity(book("House of Leaves", [edition("9780375703768", "House of Leaves")]), answers);
    expect(values(plan)).toEqual([
      ["lccn", "99036024", 1],
      ["open_library_work", "OL32195W", 1],
      ["wikidata_qid", "Q521688", 1],
      ["oclc_work", "3856843516", 1],
    ]);
    expect(plan.proposals[0].evidence.map((e) => [e.path, e.excerpt])).toEqual([
      [["isbn_13", "0"], "9780375703768"],
      [["lccn", "0"], "99036024"],
    ]);
    // Open Library answers every ISBN an edition lists with that edition's record
    const second = isbn10To13("0375410341");
    const record = answers.get(ANSWER.edition("9780375703768"))!.answer;
    const listedSecond = planIdentity(book("House of Leaves", [edition(second, "House of Leaves")]), recordedAnswers({ [ANSWER.edition(second)]: record }));
    expect(values(listedSecond)).toEqual(values(plan));
    expect(listedSecond.proposals[0].evidence[0]).toMatchObject({ path: ["isbn_10", "1"], excerpt: "0375410341" });
  });

  it("Kaputt: an ISBN listed only as an ISBN-10 matches; with no item, the title search by author QID goes to review", () => {
    const kaputt = book("Kaputt", [edition("9781590171479", "Kaputt")], { authorQids: [KAPUTT_AUTHOR] });
    const plan = planIdentity(kaputt, answers);
    expect(values(plan)).toEqual([
      ["open_library_work", "OL1272994W", 1],
      ["wikidata_qid", KAPUTT_HIT.id, 0.4],
    ]);
    expect(plan.result).toBe("review");
    expect(planIdentity({ ...kaputt, authorQids: [] }, answers).notes).toContain("No author has a Wikidata QID: run the author enrichment first");
  });

  it("holds an ID another book has: nothing is proposed for it, and the result says why", () => {
    const plan = planIdentity(
      book("Satantango", [edition("9781788166355", "Satantango")], { taken: { Q1315145: { workId: "other", slug: "satantango-again" } } }),
      answers,
    );
    expect(plan.collisions).toEqual([{ dimension: "wikidata_qid", value: "Q1315145", workId: "other", slug: "satantango-again" }]);
    expect(values(plan).map(([d]) => d)).not.toContain("wikidata_qid");
    expect(plan.result).toBe("collision");
  });

  it("proposes nothing it has, and a different value only for review", () => {
    const life = [edition("9781784871963", "Life and Fate")];
    expect(values(planIdentity(book("Life and Fate", life, { known: { wikidata_qid: "Q979609", open_library_work: "OL157104W" } }), answers))).toEqual([]);
    const differs = planIdentity(book("Life and Fate", life, { known: { wikidata_qid: "Q90000003" } }), answers);
    expect(differs.proposals.find((p) => p.dimension === "wikidata_qid")).toMatchObject({ value: "Q979609", confidence: 0.4 });
    expect(differs.proposals.find((p) => p.dimension === "wikidata_qid")!.note).toContain("differs from the accepted ID Q90000003");
  });

  it("takes an Open Library work with another author record when an exact QID confirms it, and sends it to review when none does", () => {
    // Durtal's author keys on the newest backup: Open Library keeps a second record for each author
    const life = planIdentity(
      book("Life and Fate", [edition("9781784871963", "Life and Fate")], { authorQids: ["Q313767"], authorOpenLibraryIds: ["OL4655492A"] }),
      answers,
    );
    expect(values(life)).toEqual([
      ["open_library_work", "OL157104W", 1],
      ["wikidata_qid", "Q979609", 1],
    ]);
    expect(life.proposals[0].note).toBe("every ISBN record and the exact QID's P648 name this work, and the QID's authors (P50) name the book's; its author records differ");
    const bolano = planIdentity(book("2666", [edition("9780374100148", "2666")], { authorOpenLibraryIds: ["OL6493404A"] }), answers);
    expect(bolano.proposals.find((p) => p.dimension === "open_library_work")).toMatchObject({
      value: "OL712025W",
      confidence: 0.4,
      note: "the Open Library work names other authors, and no exact QID confirms it",
    });
  });

  it("sends several Open Library works, other authors and a first year after the edition to review", () => {
    const two = planIdentity(book("Two works", [edition("9781784871963", "Life and Fate"), edition("9780241678763", "Beware of Pity")]), answers);
    expect(two.proposals.every((p) => p.confidence === 0.4 || p.dimension === "lccn")).toBe(true);
    const others = planIdentity(book("Life and Fate", [edition("9781784871963", "Life and Fate")], { authorQids: ["Q90000004"] }), answers);
    expect(others.proposals.find((p) => p.dimension === "wikidata_qid")).toMatchObject({ confidence: 0.4, note: "its authors (P50) are none of the book's" });
    const early = planIdentity(book("Life and Fate", [edition("9781784871963", "Life and Fate", { year: 1970 })]), answers);
    expect(early.proposals.find((p) => p.dimension === "wikidata_qid")).toMatchObject({ confidence: 0.4, note: "first published 1980, after the edition of 1970" });
  });

  it("finds nothing without answers, and proposes nothing for a locked edition", () => {
    expect(planIdentity(book("Unknown", [edition("9780000000002", "Unknown")]), answers)).toMatchObject({ result: "not_found", proposals: [] });
    const locked = planIdentity(book("The Skin", [edition("9781590176221", "The Skin", { locked: true })]), answers);
    expect(values(locked).map(([d]) => d)).toEqual(["open_library_work"]);
    expect(values(planIdentity(book("The Skin", [edition("9781590176221", "The Skin")]), answers))).toContainEqual(["lccn", "2012045914", 1]);
  });

  it("takes the IDs of an accepted QID: its OCLC work, and its Open Library work when no ISBN named one", () => {
    const plan = planIdentity(book("Beware of Pity", [edition(null, "Beware of Pity")], { known: { wikidata_qid: "Q1428590" } }), answers);
    expect(values(plan)).toEqual([
      ["oclc_work", "2197707", 1],
      ["open_library_work", "OL28434W", 1],
    ]);
    expect(plan.result).toBe("resolved");
  });

  it("cites in every evidence the exact value at its path in the stored answer", () => {
    const plans = [
      planIdentity(book("House of Leaves", [edition("9780375703768", "House of Leaves")]), answers),
      planIdentity(book("2666", [edition("9780374100148", "2666")]), answers),
      planIdentity(book("Kaputt", [edition("9781590171479", "Kaputt")], { authorQids: [KAPUTT_AUTHOR] }), answers),
    ];
    const refs = plans.flatMap((p) => p.proposals.flatMap((q) => q.evidence));
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      const stored = { ...(answers.get(ref.answer)!.answer as object), runId: "run" };
      const at = ref.path.reduce<unknown>((value, step) => (value as Record<string, unknown>)?.[step], stored);
      expect(at, `${ref.answer} ${ref.path.join(".")}`).toBe(ref.excerpt);
    }
    expect(refs.some((r) => r.answer === ANSWER.item("Q521688") && r.path.join() === "claims,P648,0")).toBe(true);
  });
});

describe("the identity review file", () => {
  it("takes entries that decide with a note, and refuses the rest", () => {
    const ok = { title: "2666", wikidata_qid: "Q219437", oclc_work: null, lccn: { "9780374100148": "2009290464" }, note: "the novel by Bolaño" };
    expect(identityReviewSchema.safeParse({ "2666-by-roberto-bolano": ok }).success).toBe(true);
    for (const bad of [
      { ...ok, note: "" },
      { ...ok, wikidata_qid: "219437" },
      { ...ok, lccn: { "0374100144": "2009290464" } },
      { ...ok, lccn: { "9780374100148": "2009-290464" } },
      { title: "2666", note: "nothing decided" },
      { ...ok, isbn: "9780374100148" },
    ])
      expect(identityReviewSchema.safeParse({ "2666-by-roberto-bolano": bad }).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("review #141: what confirms an Open Library work whose author records differ", () => {
  // A generic title whose ISBN record names another poet's work; Wikidata links that work both ways
  const ISBN = "9780000000002";
  const answers = recordedAnswers({
    [ANSWER.edition(ISBN)]: { key: "/books/OL900000M", title: "Selected Poems", works: [{ key: "/works/OL900001W" }], isbn_13: [ISBN], isbn_10: [], lccn: [] },
    [ANSWER.work("OL900001W")]: { key: "/works/OL900001W", title: "Selected Poems", authors: [{ author: { key: "/authors/OL900002A" } }], identifiers: { wikidata: ["Q90000010"] } },
    [ANSWER.linkedItems("OL900001W")]: ["Q90000010"],
    [ANSWER.item("Q90000010")]: { id: "Q90000010", label: "Selected Poems", claims: { P31: ["Q7725634"], P50: ["Q90000011"], P577: [], P629: [], P648: ["OL900001W"], P5331: [] } },
    [ANSWER.item("Q90000012")]: { id: "Q90000012", label: "Selected Poems", claims: { P31: ["Q7725634"], P50: [], P577: [], P629: [], P648: ["OL900003W"], P5331: [] } },
  });
  const poems = (fields: Partial<IdentityBook> = {}) => book("Selected Poems", [edition(ISBN, "Selected Poems")], { authorOpenLibraryIds: ["OL900009A"], ...fields });
  const confidences = (plan: IdentityPlan) => Object.fromEntries(plan.proposals.map((p) => [p.dimension, p.confidence]));

  it("sends the work and its QID to review when no author of the book is known on Wikidata", () => {
    expect(confidences(planIdentity(poems(), answers))).toEqual({ open_library_work: 0.4, wikidata_qid: 0.4 });
  });

  it("sends them to review when the item names no author", () => {
    const noAuthor = recordedAnswers({
      [ANSWER.edition(ISBN)]: { key: "/books/OL900000M", title: "Selected Poems", works: [{ key: "/works/OL900003W" }], isbn_13: [ISBN], isbn_10: [], lccn: [] },
      [ANSWER.work("OL900003W")]: { key: "/works/OL900003W", title: "Selected Poems", authors: [{ author: { key: "/authors/OL900002A" } }], identifiers: { wikidata: [] } },
      [ANSWER.linkedItems("OL900003W")]: ["Q90000012"],
      [ANSWER.item("Q90000012")]: { id: "Q90000012", label: "Selected Poems", claims: { P31: ["Q7725634"], P50: [], P577: [], P629: [], P648: ["OL900003W"], P5331: [] } },
    });
    expect(confidences(planIdentity(poems({ authorQids: ["Q90000013"] }), noAuthor))).toEqual({ open_library_work: 0.4, wikidata_qid: 0.4 });
  });

  it("takes both when the item's authors (P50) name the book's author: a duplicate Open Library author record", () => {
    expect(confidences(planIdentity(poems({ authorQids: ["Q90000011"] }), answers))).toEqual({ open_library_work: 1, wikidata_qid: 1 });
  });

  it("never counts a QID that differs from the book's accepted one, or that another book holds", () => {
    const life = (fields: Partial<IdentityBook>) =>
      planIdentity(book("Life and Fate", [edition("9781784871963", "Life and Fate")], { authorQids: ["Q313767"], authorOpenLibraryIds: ["OL4655492A"], ...fields }), recordedAnswers());
    expect(confidences(life({ known: { wikidata_qid: "Q90000003" } }))).toMatchObject({ open_library_work: 0.4, wikidata_qid: 0.4 });
    const held = life({ taken: { Q979609: { workId: "other", slug: "life-and-fate-again" } } });
    expect(held.collisions.map((c) => c.value)).toEqual(["Q979609"]);
    expect(confidences(held)).toEqual({ open_library_work: 0.4 });
  });
});
