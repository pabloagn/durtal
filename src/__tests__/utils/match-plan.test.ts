import { describe, expect, it } from "vitest";
import {
  isbn10To13,
  isbn13To10,
  planMatch,
  validIsbn10,
  validIsbn13,
  type MatchCandidate,
  type MatchCurrent,
} from "@/lib/match/plan";
import { cleanRecord } from "@/lib/match/source";
import { bindingLabel, normalizeBinding } from "@/lib/utils/binding";

const STRANGER = "9780679720201";
const OTHER = "9780141182506";

const current: MatchCurrent = {
  title: "The Stranger",
  subtitle: null,
  publisher: "Vintage",
  imprint: "Vintage International",
  isbn13: STRANGER,
  isbn10: "0679720200",
  publicationYear: 1989,
  pageCount: 123,
  language: "en",
  binding: null,
  publicationCountry: "United States",
  description: null,
  coverSourceUrl: null,
  hasCover: false,
};
const candidate = (c: Partial<MatchCandidate>): MatchCandidate => ({
  title: "The Stranger",
  subtitle: null,
  publisher: "Vintage",
  isbn13: STRANGER,
  isbn10: "0679720200",
  publicationYear: 1989,
  pageCount: 123,
  language: "en",
  binding: null,
  description: null,
  coverUrl: null,
  ...c,
});
const context = { workTitle: "The Stranger", authors: ["Albert Camus"], isbnOwners: {} };
const row = (plan: ReturnType<typeof planMatch>, field: string) =>
  plan.rows.find((r) => r.field === field);

describe("ISBNs", () => {
  it("accepts valid check digits only", () => {
    expect(validIsbn13("978-0-679-72020-1")).toBe(STRANGER);
    expect(validIsbn13("9780679720202")).toBeNull();
    expect(validIsbn10("0-679-72020-0")).toBe("0679720200");
    expect(validIsbn10("080442957X")).toBe("080442957X");
    expect(validIsbn10("0679720201")).toBeNull();
  });
  it("converts between ISBN-10 and ISBN-13", () => {
    expect(isbn10To13("0679720200")).toBe(STRANGER);
    expect(isbn13To10(STRANGER)).toBe("0679720200");
    expect(isbn13To10("9791032305690")).toBeNull();
  });
});

describe("source records", () => {
  it("drops values a source gets wrong", () => {
    const r = cleanRecord({
      title: "  The   Stranger ",
      publisher: "",
      isbn13: "9780679720202",
      isbn10: "0679720200",
      year: "0000",
      pages: 99999,
      language: "Martian",
      binding: "Kindle Edition",
      description: "<p>One.</p><p>Two &amp; three.</p>",
      coverUrl: "http://images.example/cover.jpg",
    });
    expect(r).toMatchObject({
      title: "The Stranger",
      publisher: null,
      // The ISBN-13 had a bad check digit; the valid ISBN-10 gives it
      isbn13: STRANGER,
      isbn10: "0679720200",
      publicationYear: null,
      pageCount: null,
      language: null,
      binding: null,
      description: "One.\nTwo & three.",
      coverUrl: "https://images.example/cover.jpg",
    });
  });
  it("removes the hidden sort markers of library records", () => {
    expect(cleanRecord({ title: "\u0098The\u009c loser" }).title).toBe("The loser");
  });
  it("reads years and languages in the forms sources send", () => {
    const r = cleanRecord({ year: "March 1989", language: "eng" });
    expect(r.publicationYear).toBe(1989);
    expect(r.language).toBe("en");
  });
});

describe("bindings", () => {
  it.each([
    ["Paperback", "paperback"],
    ["Mass Market Paperback", "paperback"],
    ["Hardcover", "hardcover"],
    ["Library Binding", "hardcover"],
    ["Leather Bound", "leather"],
    ["Board book", "boards"],
    ["Spiral-bound", "spiral"],
    ["saddle stitch", "saddle_stitch"],
    ["Kindle Edition", null],
    ["Audio CD", null],
    ["Unknown Binding", null],
    ["", null],
  ])("%s → %s", (raw, code) => {
    expect(normalizeBinding(raw)).toBe(code);
  });
  it("labels codes", () => {
    expect(bindingLabel("saddle_stitch")).toBe("Saddle stitch");
  });
});

describe("the plan", () => {
  it("same ISBN: ticks empty fields only, never clears", () => {
    const plan = planMatch(
      current,
      candidate({
        pageCount: 140,
        binding: "paperback",
        publisher: null,
        coverUrl: "https://covers.example/1.jpg",
      }),
      context,
    );
    expect(plan.newEdition).toBe(false);
    expect(row(plan, "pageCount")).toMatchObject({ current: 123, next: 140, checked: false });
    expect(row(plan, "binding")?.checked).toBe(true);
    expect(row(plan, "cover")?.checked).toBe(true);
    // No publisher from the source: the edition keeps its own
    expect(row(plan, "publisher")).toBeUndefined();
    expect(row(plan, "imprint")).toBeUndefined();
    expect(plan.same).toBeGreaterThan(3);
  });

  it("new ISBN: ticks every change and offers to clear the old imprint and country", () => {
    const plan = planMatch(
      current,
      candidate({ isbn13: OTHER, isbn10: "0141182504", publisher: "Penguin Books", pageCount: 111 }),
      context,
    );
    expect(plan.newEdition).toBe(true);
    for (const f of ["isbn13", "isbn10", "publisher", "pageCount"])
      expect(row(plan, f)?.checked).toBe(true);
    expect(row(plan, "imprint")).toMatchObject({ next: null, checked: true });
    expect(row(plan, "publicationCountry")).toMatchObject({ next: null, checked: true });
  });

  it("never ticks a distributor or placeholder as the publisher", () => {
    const plan = planMatch(
      { ...current, publisher: null },
      candidate({ publisher: "Random House Publishing Services" }),
      context,
    );
    expect(row(plan, "publisher")?.checked).toBe(false);
    expect(row(plan, "publisher")?.note).toMatch(/Not ticked/);
  });

  it("blocks an ISBN another edition holds, and ticks nothing", () => {
    const plan = planMatch(
      current,
      candidate({ isbn13: OTHER, isbn10: "0141182504", pageCount: 111 }),
      { ...context, isbnOwners: { isbn13: "Lolita", isbn10: "Lolita" } },
    );
    expect(row(plan, "isbn13")?.blocked).toMatch(/Lolita/);
    expect(plan.rows.every((r) => !r.checked)).toBe(true);
    expect(row(plan, "imprint")).toBeUndefined();
    expect(plan.warnings[0]).toMatch(/Another edition/);
  });

  it("warns when the source names another book", () => {
    const plan = planMatch(current, candidate({ title: "Collected Recipes" }), context);
    expect(plan.warnings.some((w) => w.includes("same book"))).toBe(true);
  });

  it("an edition without an ISBN takes every value", () => {
    const plan = planMatch(
      { ...current, isbn13: null, isbn10: null, imprint: "Vintage International" },
      candidate({ publisher: "Penguin Books", pageCount: 99 }),
      context,
    );
    expect(plan.newEdition).toBe(true);
    expect(row(plan, "pageCount")?.checked).toBe(true);
    // The imprint was not tied to an old ISBN
    expect(row(plan, "imprint")).toBeUndefined();
  });
});
