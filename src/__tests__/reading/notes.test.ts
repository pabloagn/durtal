import { describe, expect, it } from "vitest";
import {
  firstLines,
  formatNoteForCopy,
  formatPageInput,
  fromRoman,
  joinHyphenatedLines,
  keptNotesText,
  noteGroups,
  noteWhereText,
  notesCountText,
  pageText,
  parsePageInput,
  toRoman,
} from "@/lib/reading/notes-text";
import { editionLabels, editionShortLabel, noteEditionsOf, type LabelEdition } from "@/lib/reading/edition-label";
import { noteDefaultMode, noteEditionDefault } from "@/lib/reading/note-defaults";
import { NOTES_PER_PAGE, notesHref, parseNotesQuery } from "@/lib/reading/notes-params";
import { choosePassage, daysSinceEpoch, passageCandidates } from "@/lib/reading/passage";
import { importNoteBody, importNoteKey, importNoteState, noteReadingId, noteTooLong, readingsCommitted } from "@/lib/reading/import/notes";

/* The commonplace book's pure rules (SLN-453). */

/** One page, not front matter */
const at = { endPage: null, pageRoman: false };

describe("joinHyphenatedLines", () => {
  it("joins a word broken over two lines", () => {
    expect(joinHyphenatedLines("the melan-\ncholy of it")).toBe("the melancholy of it");
    expect(joinHyphenatedLines("mélan-\r\n  colie")).toBe("mélancolie");
  });
  it("keeps a hyphenated name, a plain line break and a hyphen at the end", () => {
    expect(joinHyphenatedLines("Saint-\nSimon")).toBe("Saint-\nSimon");
    expect(joinHyphenatedLines("one line\nanother")).toBe("one line\nanother");
    expect(joinHyphenatedLines("ends with a dash-")).toBe("ends with a dash-");
  });
});

describe("formatNoteForCopy", () => {
  const book = { title: "Nadja", author: "André Breton" };
  it("gives the passage in quotes, then the author, title and page", () => {
    expect(formatNoteForCopy({ ...at, body: "Beauty will be convulsive", page: 212, chapter: "7" }, book)).toBe("“Beauty will be convulsive”\nAndré Breton, Nadja, p. 212");
  });
  it("gives the chapter when there is no page, and nothing after the title without either", () => {
    expect(formatNoteForCopy({ ...at, body: "x", page: null, chapter: "7" }, book)).toBe("“x”\nAndré Breton, Nadja, ch. 7");
    expect(formatNoteForCopy({ ...at, body: "x", page: null, chapter: null }, book)).toBe("“x”\nAndré Breton, Nadja");
    expect(formatNoteForCopy({ ...at, body: "x", page: null, chapter: null }, { title: "Anon", author: null })).toBe("“x”\nAnon");
  });
  it("keeps a passage's line breaks", () => {
    expect(formatNoteForCopy({ ...at, body: "First line\nSecond line", page: 3, chapter: null }, book)).toBe("“First line\nSecond line”\nAndré Breton, Nadja, p. 3");
  });
});

describe("the note's words", () => {
  it("says where a note is and counts quotes and notes", () => {
    expect(noteWhereText({ ...at, page: 212, chapter: "7", percent: 44 })).toBe("p. 212 · ch. 7");
    expect(noteWhereText({ ...at, page: null, chapter: null, percent: 44.4 })).toBe("44%");
    expect(noteWhereText({ ...at, page: null, chapter: null, percent: null })).toBeNull();
    expect(notesCountText(12, 2)).toBe("12 quotes and 2 notes");
    expect(notesCountText(1, 0)).toBe("1 quote");
    expect(notesCountText(0, 1)).toBe("1 note");
    expect(notesCountText(0, 0)).toBe("");
  });
  it("shows the first three lines, at most 300 characters", () => {
    expect(firstLines("a\nb\nc\nd")).toBe("a\nb\nc…");
    expect(firstLines("a\nb")).toBe("a\nb");
    expect(firstLines("x".repeat(400))).toBe(`${"x".repeat(300)}…`);
  });
});

describe("parseNotesQuery", () => {
  const id = "0b5f2f48-3d43-4c1e-9e43-3c1f6d1b2a10";
  it("reads every parameter", () => {
    expect(parseNotesQuery({ q: " melancolie ", book: id, author: id, edition: "none", translator: id, kind: "quote", fav: "1", year: "2024", sort: "book", order: "desc", page: "3", perPage: "96" })).toEqual({
      q: "melancolie",
      workId: id,
      authorId: id,
      editionId: "none",
      translatorId: id,
      kind: "quote",
      favourites: true,
      year: 2024,
      sort: "book",
      order: "desc",
      page: 3,
      perPage: 96,
      offset: 2 * 96,
    });
  });
  it("drops bad values", () => {
    expect(parseNotesQuery({ book: "nadja", author: "1", kind: "highlight", fav: "yes", year: "24", sort: "rating", order: "up", page: "-2", perPage: "50" })).toEqual({
      q: undefined,
      workId: undefined,
      authorId: undefined,
      kind: undefined,
      favourites: false,
      year: undefined,
      sort: "newest",
      order: "desc",
      page: 1,
      perPage: NOTES_PER_PAGE,
      offset: 0,
    });
  });
  it("lists the best match first for a search, and never without one", () => {
    expect(parseNotesQuery({ q: "paris" }).sort).toBe("relevance");
    expect(parseNotesQuery({ sort: "relevance" }).sort).toBe("newest");
    expect(parseNotesQuery({ q: "paris", sort: "newest" }).sort).toBe("newest");
    expect(notesHref({ q: "paris", sort: "relevance", page: 2 })).toBe("/reading/notes?q=paris&page=2");
    expect(notesHref({ sort: "newest", order: "asc", kind: "note" })).toBe("/reading/notes?kind=note&order=asc");
    expect(notesHref({ translatorId: id })).toBe(`/reading/notes?translator=${id}`);
    expect(notesHref({ workId: id, editionId: "none" })).toBe(`/reading/notes?book=${id}&edition=none`);
    expect(parseNotesQuery({ edition: "x", translator: "y" })).toMatchObject({ editionId: undefined, translatorId: undefined });
  });
});

describe("choosePassage", () => {
  const quotes = (n: number, favourites = 0) => Array.from({ length: n }, (_, i) => ({ id: `q-${i}`, isFavourite: i < favourites }));
  const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 9, 5 + i)).toISOString().slice(0, 10));

  it("gives one passage all day", () => {
    const list = quotes(12, 3);
    expect(choosePassage(list, "2026-10-05")).toEqual(choosePassage([...list].reverse(), "2026-10-05"));
  });
  it("never repeats in 30 days with 30 favourites, and leaves the others out", () => {
    const list = quotes(40, 30);
    const chosen = days(30).map((d) => choosePassage(list, d)!);
    expect(new Set(chosen.map((q) => q.id)).size).toBe(30);
    expect(chosen.every((q) => q.isFavourite)).toBe(true);
  });
  it("takes every quote, favourites first, with fewer than 30 favourites; 12 days never repeat", () => {
    const list = quotes(12, 3);
    const candidates = passageCandidates(list);
    expect(candidates).toHaveLength(12);
    expect(candidates.slice(0, 3).every((q) => q.isFavourite)).toBe(true);
    expect(new Set(days(12).map((d) => choosePassage(list, d)!.id)).size).toBe(12);
  });
  it("steps to the next candidate for Another, and gives none without quotes", () => {
    const list = quotes(5);
    expect(choosePassage(list, "2026-10-05", 1)).toEqual(choosePassage(list, "2026-10-06"));
    expect(choosePassage([], "2026-10-05")).toBeNull();
    expect(daysSinceEpoch("1970-01-02")).toBe(1);
  });
});

describe("Goodreads private notes", () => {
  it("keys a note by Book Id, else ISBN-13, else title and author", () => {
    const row = { sourceBookId: "1111", isbn13: "9782070360260", title: "Nadja", authors: ["André Breton"] };
    expect(importNoteKey(row)).toBe("goodreads-note:1111");
    expect(importNoteKey({ ...row, sourceBookId: null })).toBe("goodreads-note:isbn13:9782070360260");
    expect(importNoteKey({ ...row, sourceBookId: null, isbn13: null })).toMatch(/^goodreads-note:title:[0-9a-f]{64}$/);
  });
  it("strips tags and keeps line breaks, and refuses a note over 10,000 characters", () => {
    expect(importNoteBody("Lent to Ana<br/>Read <b>twice</b>")).toBe("Lent to Ana\nRead twice");
    expect(noteTooLong("x".repeat(12_400))).toBe("Too long to import (12,400 characters; at most 10,000)");
    expect(noteTooLong("x".repeat(10_000))).toBeNull();
  });
  it("puts a note on the row's latest read in Durtal", () => {
    const match = { verdicts: [{ n: 1, verdict: "already_present" as const, reason: "Same finish date", readingId: "r1" }, { n: 2, verdict: "new" as const, reason: null, readingId: null }] };
    expect(noteReadingId(null, match)).toBe("r1");
    expect(noteReadingId({ readings: [{ n: 2, readingId: "r2" }] }, match)).toBe("r2");
    expect(noteReadingId(null, { verdicts: [] })).toBeNull();
  });
  it("counts a row as committed by its readings or Up Next item, never by its note alone", () => {
    expect(readingsCommitted(null)).toBe(false);
    expect(readingsCommitted({ readings: [], noteIds: ["n1"] })).toBe(false);
    expect(readingsCommitted({ readings: [{ n: 1, readingId: "r1" }], noteIds: ["n1"] })).toBe(true);
    expect(readingsCommitted({ readings: [], queueOutcome: "written" })).toBe(true);
  });
  it("says where a note stands", () => {
    const base = { written: null, keyExists: false, tooLong: false, workId: "w", decision: "pending" as const };
    expect(importNoteState(base)).toBe("pending");
    expect(importNoteState({ ...base, written: { noteIds: ["n"] }, keyExists: true })).toBe("imported");
    expect(importNoteState({ ...base, keyExists: true })).toBe("present");
    expect(importNoteState({ ...base, tooLong: true })).toBe("too_long");
    expect(importNoteState({ ...base, workId: null })).toBe("no_book");
  });
});

/* Quotes tied to editions, with page numbers (SLN-480) */

describe("parsePageInput and formatPageInput", () => {
  const ok = (text: string) => {
    const r = parsePageInput(text);
    if (!r.ok) throw new Error(`${text}: ${r.error}`);
    return r.value;
  };
  it("reads a page, a range in three dashes with or without spaces, and a shortened end", () => {
    expect(ok("212")).toEqual({ page: 212, endPage: null, pageRoman: false });
    for (const text of ["212-213", "212–213", "212—213", "212 - 213", " 212 – 213 "]) expect(ok(text)).toEqual({ page: 212, endPage: 213, pageRoman: false });
    expect(ok("212-13")).toEqual({ page: 212, endPage: 213, pageRoman: false });
    expect(ok("98-102")).toEqual({ page: 98, endPage: 102, pageRoman: false });
    expect(ok("")).toEqual({ page: null, endPage: null, pageRoman: false });
  });
  it("stores a range whose ends are equal as one page", () => {
    expect(ok("212-212")).toEqual({ page: 212, endPage: null, pageRoman: false });
    expect(ok("212-2")).toEqual({ page: 212, endPage: null, pageRoman: false });
  });
  it("reads front matter in roman numerals, in any case", () => {
    expect(ok("xiv")).toEqual({ page: 14, endPage: null, pageRoman: true });
    expect(ok("XIV-xvi")).toEqual({ page: 14, endPage: 16, pageRoman: true });
    expect([fromRoman("mcmxcix"), fromRoman("iiii"), fromRoman("vx"), toRoman(1999), toRoman(4)]).toEqual([1999, null, null, "mcmxcix", "iv"]);
  });
  it("refuses a malformed roman numeral and a mixed range", () => {
    for (const text of ["iiii", "vx", "xiv-20", "20-xiv", "p. 12", "12-13-14", "-12"])
      expect(parsePageInput(text)).toEqual({ ok: false, error: "Enter a page such as 212, 212-213 or xiv" });
  });
  it("says so when a range runs backwards", () => {
    for (const text of ["300-200", "213-212", "213-1", "xvi-xiv"])
      expect(parsePageInput(text)).toEqual({ ok: false, error: "The second page comes before the first" });
  });
  it("shows a stored place as typed, and as words", () => {
    expect(formatPageInput({ page: 212, endPage: 213, pageRoman: false })).toBe("212–213");
    expect(formatPageInput({ page: 14, endPage: 16, pageRoman: true })).toBe("xiv–xvi");
    expect(formatPageInput({ page: null, endPage: null, pageRoman: false })).toBe("");
    expect(pageText({ page: 212, endPage: null, pageRoman: false })).toBe("p. 212");
    expect(pageText({ page: 212, endPage: 213, pageRoman: false })).toBe("pp. 212–213");
    expect(pageText({ page: 14, endPage: null, pageRoman: true })).toBe("p. xiv");
    expect(pageText({ page: 14, endPage: 16, pageRoman: true })).toBe("pp. xiv–xvi");
  });
});

describe("edition labels", () => {
  const ed = (id: string, over: Partial<LabelEdition> = {}): LabelEdition => ({
    id,
    title: "Don Quixote",
    language: "en",
    publisher: null,
    year: null,
    translators: [],
    ...over,
  });
  it("names the title when it differs, the publisher, the year and the translators", () => {
    expect(editionShortLabel(ed("a", { publisher: "Penguin Classics", year: 2003, translators: ["Edith Grossman"] }), "Don Quixote")).toBe(
      "Penguin Classics, 2003, tr. Edith Grossman",
    );
    expect(editionShortLabel(ed("a", { title: "The Ingenious Gentleman", publisher: "Ecco", translators: ["A", "B", "C"] }), "Don Quixote")).toBe(
      "The Ingenious Gentleman, Ecco, tr. A, B and C",
    );
    expect(editionShortLabel(ed("a"), "Don Quixote")).toBe("Edition not identified");
  });
  it("puts the language first when the editions span more than one", () => {
    const labels = editionLabels([ed("a", { publisher: "Penguin", year: 2003 }), ed("b", { language: "es", publisher: "Cátedra", year: 2005 })], "Don Quixote");
    expect([...labels.values()]).toEqual(["English · Penguin, 2003", "Spanish · Cátedra, 2005"]);
  });
  it("tells two alike apart by binding, then the ISBN's last four digits, then their place", () => {
    const same = { publisher: "Penguin", year: 2003 };
    expect([...editionLabels([ed("a", { ...same, binding: "hardcover" }), ed("b", { ...same, binding: "paperback" })], "Don Quixote").values()]).toEqual([
      "Penguin, 2003, Hardcover",
      "Penguin, 2003, Paperback",
    ]);
    expect([...editionLabels([ed("a", { ...same, isbn13: "9780060934347" }), ed("b", { ...same, isbn13: "9780142437230" })], "Don Quixote").values()]).toEqual([
      "Penguin, 2003, ISBN …4347",
      "Penguin, 2003, ISBN …7230",
    ]);
    expect([...editionLabels([ed("a", same), ed("b", same), ed("c", { publisher: "Ecco" })], "Don Quixote").values()]).toEqual([
      "Penguin, 2003 (1)",
      "Penguin, 2003 (2)",
      "Ecco",
    ]);
  });
});

describe("the note's place, edition and citation", () => {
  const penguin = noteEditionsOf([{ id: "e1", title: "Don Quixote", language: "en", publisher: "Ecco", year: 2003, translators: ["Edith Grossman"] }], "Don Quixote").e1;
  it("names the edition after the place, and says when a page has none", () => {
    expect(noteWhereText({ page: 212, endPage: 213, pageRoman: false, chapter: "7", percent: 40 }, penguin)).toBe("pp. 212–213 · Ecco, 2003, tr. Edith Grossman · ch. 7");
    expect(noteWhereText({ page: 14, endPage: null, pageRoman: true, chapter: null, percent: null }, null)).toBe("p. xiv · edition not recorded");
    expect(noteWhereText({ page: null, endPage: null, pageRoman: false, chapter: null, percent: 44 }, null)).toBe("44%");
    // On the book page the group names the edition: none is passed
    expect(noteWhereText({ page: 212, endPage: null, pageRoman: false, chapter: null, percent: 40 })).toBe("p. 212");
  });
  it("cites the translator, publisher and year, a range and a roman page", () => {
    const book = { title: "Don Quixote", author: "Miguel de Cervantes" };
    expect(formatNoteForCopy({ body: "Tilting", page: 212, endPage: null, pageRoman: false, chapter: null }, book, penguin)).toBe(
      "“Tilting”\nMiguel de Cervantes, Don Quixote, tr. Edith Grossman (Ecco, 2003), p. 212",
    );
    expect(formatNoteForCopy({ body: "x", page: 212, endPage: 213, pageRoman: false, chapter: null }, book, penguin)).toMatch(/, pp\. 212–213$/);
    expect(formatNoteForCopy({ body: "x", page: 14, endPage: null, pageRoman: true, chapter: null }, book, penguin)).toMatch(/, p\. xiv$/);
    const bare = noteEditionsOf([{ id: "e2", title: "El ingenioso hidalgo", language: "es", publisher: null, year: null, translators: [] }], "Don Quixote").e2;
    expect(formatNoteForCopy({ body: "x", page: null, endPage: null, pageRoman: false, chapter: "7" }, book, bare)).toBe("“x”\nMiguel de Cervantes, El ingenioso hidalgo, ch. 7");
    expect(formatNoteForCopy({ body: "x", page: 3, endPage: null, pageRoman: false, chapter: null }, book)).toBe("“x”\nMiguel de Cervantes, Don Quixote, p. 3");
  });
  it("says what a delete leaves with the book", () => {
    expect(keptNotesText(4, 1, ", without this edition")).toBe(" Its 4 quotes and 1 note stay with the book, without this edition.");
    expect(keptNotesText(1, 0)).toBe(" Its 1 quote stays with the book.");
    expect(keptNotesText(0, 0)).toBe("");
  });
  it("groups a book's notes by edition in the Editions order, no edition last", () => {
    const n = (id: string, editionId: string | null) => ({ id, editionId }) as never;
    const labels = { e1: { label: "A" }, e2: { label: "B" } } as never;
    const groups = noteGroups([n("1", "e2"), n("2", null), n("3", "e1"), n("4", "e2")], ["e1", "e2", "e3"], labels);
    expect(groups.map((g) => [g.editionId, g.label, g.notes.map((x) => x.id)])).toEqual([
      ["e1", "A", ["3"]],
      ["e2", "B", ["1", "4"]],
      [null, "No edition recorded", ["2"]],
    ]);
  });
});

describe("the note dialog's defaults", () => {
  const e = (id: string, copies: { id: string; status: string; locationId: string; locationType: string }[] = [], pageCount: number | null = null) =>
    ({ id, pageCount, copies: copies.map((c) => ({ ...c, locationName: null, subLocationName: null, lentTo: null, lentDate: null })) }) as never;
  const editions = [e("e1", [], 300), e("e2", [{ id: "i2", status: "available", locationId: "home", locationType: "physical" }]), e("e3")];
  const base = { callerEditionId: null, readingEditionId: null, homeId: "home", lastReadingEditionId: null };
  it("takes the caller's edition, then the reading's, then the one at hand at home", () => {
    expect(noteEditionDefault(editions, { ...base, callerEditionId: "e3", readingEditionId: "e1" })).toEqual({ editionId: "e3", source: "caller" });
    expect(noteEditionDefault(editions, { ...base, readingEditionId: "e1" })).toEqual({ editionId: "e1", source: "reading" });
    expect(noteEditionDefault(editions, base)).toEqual({ editionId: "e2", source: "default" });
    expect(noteEditionDefault([], base)).toEqual({ editionId: null, source: "default" });
  });
  it("opens in Percent for a request with a percent, in Page for one with a page, else as the reading counts on its own edition", () => {
    expect(noteDefaultMode({ request: { percent: null }, readingUnit: "pages", onReadingEdition: true })).toBe("percent");
    expect(noteDefaultMode({ request: { page: 12 }, readingUnit: "percent", onReadingEdition: true })).toBe("page");
    expect(noteDefaultMode({ request: {}, readingUnit: "minutes", onReadingEdition: true })).toBe("percent");
    expect(noteDefaultMode({ request: {}, readingUnit: "minutes", onReadingEdition: false })).toBe("page");
  });
});
