import { describe, expect, it } from "vitest";
import { firstLines, formatNoteForCopy, joinHyphenatedLines, noteWhereText, notesCountText } from "@/lib/reading/notes-text";
import { NOTES_PER_PAGE, notesHref, parseNotesQuery } from "@/lib/reading/notes-params";
import { choosePassage, daysSinceEpoch, passageCandidates } from "@/lib/reading/passage";
import { importNoteBody, importNoteKey, importNoteState, noteReadingId, noteTooLong, readingsCommitted } from "@/lib/reading/import/notes";

/* The commonplace book's pure rules (SLN-453). */

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
    expect(formatNoteForCopy({ body: "Beauty will be convulsive", page: 212, chapter: "7" }, book)).toBe("“Beauty will be convulsive”\nAndré Breton, Nadja, p. 212");
  });
  it("gives the chapter when there is no page, and nothing after the title without either", () => {
    expect(formatNoteForCopy({ body: "x", page: null, chapter: "7" }, book)).toBe("“x”\nAndré Breton, Nadja, ch. 7");
    expect(formatNoteForCopy({ body: "x", page: null, chapter: null }, book)).toBe("“x”\nAndré Breton, Nadja");
    expect(formatNoteForCopy({ body: "x", page: null, chapter: null }, { title: "Anon", author: null })).toBe("“x”\nAnon");
  });
  it("keeps a passage's line breaks", () => {
    expect(formatNoteForCopy({ body: "First line\nSecond line", page: 3, chapter: null }, book)).toBe("“First line\nSecond line”\nAndré Breton, Nadja, p. 3");
  });
});

describe("the note's words", () => {
  it("says where a note is and counts quotes and notes", () => {
    expect(noteWhereText({ page: 212, chapter: "7", percent: 44 })).toBe("p. 212 · ch. 7");
    expect(noteWhereText({ page: null, chapter: null, percent: 44.4 })).toBe("44%");
    expect(noteWhereText({ page: null, chapter: null, percent: null })).toBeNull();
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
    expect(parseNotesQuery({ q: " melancolie ", book: id, author: id, kind: "quote", fav: "1", year: "2024", sort: "book", order: "desc", page: "3", perPage: "96" })).toEqual({
      q: "melancolie",
      workId: id,
      authorId: id,
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
