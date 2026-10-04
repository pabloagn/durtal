import { describe, expect, it } from "vitest";
import {
  EDITION_FILL_COLUMNS,
  NEVER_WRITTEN_COLUMNS,
  WORK_FILL_COLUMNS,
  editionUpdate,
  planEdition,
  plausible,
  suspectOriginalYear,
  titlesAgree,
  type EditionRow,
} from "@/lib/books/enrichment";
import type { MatchCandidate } from "@/lib/match/plan";

const DESCRIPTION =
  "Zosima's monastery, the father's murder and three brothers who cannot agree on God: a novel about faith, doubt and freedom.";

const edition = (over: Partial<EditionRow> = {}): EditionRow => ({
  id: "e1",
  workId: "w1",
  title: "The Brothers Karamazov",
  isbn13: "9780374528379",
  isbn10: "0374528373",
  publisher: "Farrar, Straus and Giroux",
  publicationYear: null,
  pageCount: null,
  language: "en",
  binding: null,
  description: null,
  metadataLocked: false,
  metadataSource: "isbndb",
  workTitle: "The Brothers Karamazov",
  workDescription: null,
  workOriginalYear: 1880,
  ...over,
});
const record = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  title: "The Brothers Karamazov: A Novel in Four Parts",
  subtitle: null,
  publisher: "Farrar, Straus and Giroux",
  isbn13: "9780374528379",
  isbn10: "0374528373",
  publicationYear: 2002,
  pageCount: 796,
  language: "en",
  binding: "paperback",
  description: DESCRIPTION,
  coverUrl: "https://images.isbndb.com/covers/x.jpg",
  ...over,
});

describe("the write path", () => {
  it("never writes an image, an ISBN, a publisher or an imprint", () => {
    const writable = [...EDITION_FILL_COLUMNS, ...WORK_FILL_COLUMNS] as string[];
    for (const column of NEVER_WRITTEN_COLUMNS) expect(writable).not.toContain(column);
    for (const column of writable) expect(column).not.toMatch(/cover|thumbnail|poster|image|isbn|publisher|imprint|media/);
  });

  it("refuses a fill outside the allowed columns", () => {
    const plan = planEdition(edition(), { isbndb: record() });
    expect(editionUpdate(plan)).toEqual({
      description: DESCRIPTION,
      page_count: 796,
      publication_year: 2002,
      binding: "paperback",
    });
    expect(() =>
      editionUpdate({ ...plan, fills: [{ column: "cover_s3_key" as never, value: "x", sources: ["isbndb"] }] }),
    ).toThrow("Refusing to write cover_s3_key");
  });
});

describe("which editions and sources count", () => {
  it.each([
    [{ metadataLocked: true }, "metadata locked"],
    [{ metadataSource: "phantom_canon" }, "placeholder edition (Identify queue)"],
    [{ isbn13: null, isbn10: null }, "no ISBN"],
  ])("leaves %o alone", (over, reason) => {
    const plan = planEdition(edition(over), { isbndb: record() });
    expect(plan.skipped).toBe(reason);
    expect(plan.fills).toEqual([]);
  });

  it("uses a source only with the exact ISBN and a matching title", () => {
    const plan = planEdition(edition(), {
      isbndb: record({ isbn13: "9780140449242", isbn10: null }),
      open_library: record({ title: "Crime and Punishment" }),
    });
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected).toEqual({
      isbndb: "another ISBN",
      open_library: 'title "Crime and Punishment" does not match',
    });
    expect(plan.fills).toEqual([]);
  });

  it("agrees on titles with a subtitle or most words in common", () => {
    expect(titlesAgree("The Brothers Karamazov", "The Brothers Karamazov: A Novel")).toBe(true);
    expect(titlesAgree("Brothers Karamazov", "The Brothers Karamazov")).toBe(true);
    expect(titlesAgree("The Idiot", "The Brothers Karamazov")).toBe(false);
  });
});

describe("what gets filled", () => {
  it("fills only empty fields and reports values that differ", () => {
    const plan = planEdition(edition({ pageCount: 701, language: "en" }), {
      isbndb: record({ language: "ru" }),
    });
    expect(plan.fills.map((f) => f.column)).toEqual(["description", "publication_year", "binding"]);
    expect(plan.differs).toEqual([
      expect.objectContaining({ column: "page_count", current: 701, found: { isbndb: 796 } }),
      expect.objectContaining({ column: "language", current: "en", found: { isbndb: "ru" } }),
    ]);
  });

  it("holds a field when the two sources disagree", () => {
    const plan = planEdition(edition(), {
      isbndb: record({ publicationYear: 2002 }),
      open_library: record({ publicationYear: 1990 }),
    });
    expect(plan.fills.find((f) => f.column === "publication_year")).toBeUndefined();
    expect(plan.held).toContainEqual(
      expect.objectContaining({ column: "publication_year", reason: "the sources disagree" }),
    );
  });

  it("takes the lower of two close page counts, from both sources", () => {
    const plan = planEdition(edition(), {
      isbndb: record({ pageCount: 796 }),
      open_library: record({ pageCount: 776 }),
    });
    expect(plan.fills.find((f) => f.column === "page_count")).toEqual({
      column: "page_count",
      value: 776,
      sources: ["isbndb", "open_library"],
    });
  });

  it("holds implausible values: a year before the work, a stub description, 5 pages", () => {
    const plan = planEdition(edition(), {
      isbndb: record({ publicationYear: 1850, description: "A novel.", pageCount: 5 }),
    });
    expect(plan.fills).toEqual([{ column: "binding", value: "paperback", sources: ["isbndb"] }]);
    expect(plan.held.map((h) => h.column)).toEqual(["description", "page_count", "publication_year"]);
  });

  it("gives an empty work the edition's new description, never over an existing one", () => {
    expect(planEdition(edition(), { isbndb: record() }).workFills).toEqual([
      { column: "description", value: DESCRIPTION, sources: ["isbndb"] },
    ]);
    expect(planEdition(edition({ workDescription: "Ours." }), { isbndb: record() }).workFills).toEqual([]);
  });

  it("only reports publishers: a different one, or one for an empty field", () => {
    const differs = planEdition(edition(), { isbndb: record({ publisher: "Penguin Classics" }) });
    expect(differs.differs).toContainEqual(expect.objectContaining({ column: "publisher" }));
    const empty = planEdition(edition({ publisher: null }), { isbndb: record() });
    expect(empty.held).toContainEqual(
      expect.objectContaining({ column: "publisher", reason: "an empty publisher is left to the publisher name inbox" }),
    );
    expect(Object.keys(editionUpdate(empty))).not.toContain("publisher");
  });
});

describe("plausibility and original years", () => {
  it("checks years, pages and descriptions", () => {
    const e = { workOriginalYear: null };
    expect(plausible("publication_year", 2031, e, 2026)).toMatchObject({ ok: false });
    expect(plausible("publication_year", 1449, e, 2026)).toMatchObject({ ok: false });
    expect(plausible("page_count", 3001, e)).toMatchObject({ ok: false });
    expect(plausible("description", "No description available for this title at the moment, sorry about that; please check back later.", e)).toMatchObject({ ok: false });
    expect(plausible("page_count", 320, e)).toEqual({ ok: true, value: 320 });
  });

  it("flags a work whose original year is an edition year", () => {
    expect(suspectOriginalYear(2003, [2003, 2010])).toMatch(/equals an edition year/);
    expect(suspectOriginalYear(2005, [2003])).toMatch(/after its earliest edition/);
    expect(suspectOriginalYear(1880, [2003])).toBeNull();
    expect(suspectOriginalYear(1950, [1950])).toBeNull();
  });
});
