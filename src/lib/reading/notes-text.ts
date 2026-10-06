import type { NoteEdit, NoteItem } from "@/lib/actions/reading-notes";
import { namesText, type NoteEdition } from "./edition-label";

/*
 * The commonplace book's text rules (SLN-453; pages and editions, SLN-480).
 * Pure: the page, the dialog and the tests share them.
 */

/** A note as a page sends it to the browser: what the item, the star, Copy and Edit need, nothing more */
export function slimNote(n: NoteItem): NoteEdit {
  return {
    id: n.id,
    workId: n.workId,
    kind: n.kind,
    body: n.body,
    commentHtml: n.commentHtml,
    page: n.page,
    endPage: n.endPage,
    pageRoman: n.pageRoman,
    chapter: n.chapter,
    percent: n.percent,
    isFavourite: n.isFavourite,
    readingId: n.readingId,
    readingOrdinal: n.readingOrdinal,
    editionId: n.editionId,
  };
}

/** Where a note is on its edition's pages: one page, or a passage over a page turn; front matter in roman numerals */
export interface PagePlace {
  page: number | null;
  endPage: number | null;
  pageRoman: boolean;
}

const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];
/** A well-formed roman numeral from 1 to 3999: no "iiii", no "vx" */
const WELL_FORMED = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

/** 14 as "xiv" */
export function toRoman(n: number): string {
  let out = "";
  for (const [value, letters] of ROMAN)
    while (n >= value) {
      out += letters;
      n -= value;
    }
  return out;
}

/** "xiv" as 14; null when it is not a well-formed numeral */
export function fromRoman(text: string): number | null {
  const t = text.toLowerCase();
  if (!t || !WELL_FORMED.test(t)) return null;
  let n = 0;
  let at = 0;
  for (const [value, letters] of ROMAN)
    while (t.startsWith(letters, at)) {
      n += value;
      at += letters.length;
    }
  return n || null;
}

export const PAGE_INPUT_ERROR = "Enter a page such as 212, 212-213 or xiv";

/**
 * The page field as typed: "212", "212-213" (a hyphen, an en dash or an em
 * dash, spaces or not), "212-13" (the second number takes the first one's
 * leading digits), "xiv", "xiv-xvi", in any letter case. A range whose ends
 * are equal is one page. Empty is no page.
 */
export function parsePageInput(text: string): { ok: true; value: PagePlace } | { ok: false; error: string } {
  const t = text.trim().toLowerCase();
  if (!t) return { ok: true, value: { page: null, endPage: null, pageRoman: false } };
  const parts = t.split(/\s*[-–—]\s*/);
  if (parts.length > 2 || parts.some((p) => !p)) return { ok: false, error: PAGE_INPUT_ERROR };
  const arabic = parts.every((p) => /^\d{1,7}$/.test(p));
  const roman = !arabic && parts.every((p) => /^[ivxlcdm]+$/.test(p));
  if (!arabic && !roman) return { ok: false, error: PAGE_INPUT_ERROR };
  let first: number | null;
  let last: number | null;
  if (arabic) {
    first = Number(parts[0]);
    // "212-13": the end takes the start's leading digits
    const end = parts[1] && parts[1].length < parts[0].length ? parts[0].slice(0, parts[0].length - parts[1].length) + parts[1] : parts[1];
    last = end === undefined ? null : Number(end);
  } else {
    first = fromRoman(parts[0]);
    last = parts[1] === undefined ? null : fromRoman(parts[1]);
    if (first === null || (parts[1] !== undefined && last === null)) return { ok: false, error: PAGE_INPUT_ERROR };
  }
  if (last !== null && last < first!) return { ok: false, error: PAGE_INPUT_ERROR };
  if (first! > 1_000_000 || (last ?? 0) > 1_000_000) return { ok: false, error: PAGE_INPUT_ERROR };
  return { ok: true, value: { page: first, endPage: last !== null && last !== first ? last : null, pageRoman: roman } };
}

/** The page field for an edit: "212", "212–213", "xiv", "xiv–xvi"; empty without a page */
export function formatPageInput(place: PagePlace): string {
  if (place.page == null) return "";
  const show = (n: number) => (place.pageRoman ? toRoman(n) : String(n));
  return place.endPage != null ? `${show(place.page)}–${show(place.endPage)}` : show(place.page);
}

/** "p. 212", "pp. 212–213", "p. xiv", "pp. xiv–xvi"; null without a page */
export function pageText(place: PagePlace): string | null {
  if (place.page == null) return null;
  return `${place.endPage != null ? "pp." : "p."} ${formatPageInput(place)}`;
}

/**
 * Joins a word that a pasted page broke over two lines: "melan-\ncholy"
 * becomes "melancholy" when the next line starts with a lower-case letter.
 * "Saint-\nSimon" keeps its hyphen and its line break, and so does a hyphen
 * at the end of the text. Other line breaks stay.
 */
export function joinHyphenatedLines(text: string): string {
  return text.replace(/(\p{L})-[ \t]*\r?\n[ \t]*(?=\p{Ll})/gu, "$1");
}

export interface CopyNote extends PagePlace {
  body: string;
  chapter: string | null;
}

export interface CopyBook {
  title: string;
  author: string | null;
}

/**
 * Where a passage comes from, the line under it in Copy: "Miguel de
 * Cervantes, Don Quixote, tr. Edith Grossman (Ecco, 2003), p. 212". The
 * title is the edition's when the note has one. A part that is missing drops
 * out with its punctuation; ", ch. 7" stands for a missing page.
 */
export function noteCitation(note: Omit<CopyNote, "body">, book: CopyBook, edition?: NoteEdition | null): string {
  const page = pageText(note);
  const where = page ? `, ${page}` : note.chapter ? `, ch. ${note.chapter}` : "";
  const translators = edition?.translators.length ? `tr. ${namesText(edition.translators)}` : null;
  const imprint = edition ? [edition.publisher, edition.year].filter(Boolean).join(", ") : "";
  const source = [book.author, edition?.title || book.title, translators].filter(Boolean).join(", ");
  return `${source}${imprint ? ` (${imprint})` : ""}${where}`;
}

/** The clipboard text of a quote or note: the passage in double quotes, a new line, then its citation */
export function formatNoteForCopy(note: CopyNote, book: CopyBook, edition?: NoteEdition | null): string {
  return `“${note.body.trim()}”\n${noteCitation(note, book, edition)}`;
}

/**
 * "p. 212 · ch. 7", "pp. 212–213", "44%", or null. With `edition` given:
 * its label after the place ("p. 212 · Penguin Classics, 2003 · ch. 7"),
 * or "edition not recorded" for a page with no edition (null).
 */
export function noteWhereText(
  note: PagePlace & { chapter: string | null; percent: number | null },
  edition?: NoteEdition | null,
): string | null {
  const place = pageText(note) ?? (note.percent != null ? `${Math.round(note.percent)}%` : null);
  const named = edition === undefined ? null : edition ? edition.label : note.page != null ? "edition not recorded" : null;
  const text = [place, named, note.chapter ? `ch. ${note.chapter}` : null].filter(Boolean).join(" · ");
  return text || null;
}

/** "12 quotes and 2 notes", "1 quote", "3 notes"; empty for none */
export function notesCountText(quotes: number, notes: number): string {
  const parts = [quotes ? `${quotes} ${quotes === 1 ? "quote" : "quotes"}` : null, notes ? `${notes} ${notes === 1 ? "note" : "notes"}` : null];
  return parts.filter(Boolean).join(" and ");
}

/**
 * " Its 3 quotes and 1 note stay with the book." when there are any, for a
 * delete's confirmation; `after` goes before the full stop (", without this
 * edition").
 */
export function keptNotesText(quotes: number, notes: number, after = ""): string {
  const n = quotes + notes;
  return n ? ` Its ${notesCountText(quotes, notes)} ${n === 1 ? "stays" : "stay"} with the book${after}.` : "";
}

/** The first `lines` lines of a text, at most `chars` characters, with an ellipsis when there is more */
export function firstLines(text: string, lines = 3, chars = 300): string {
  const all = text.trim().split(/\r?\n/);
  const kept = all.slice(0, lines).join("\n");
  if (kept.length > chars) return `${kept.slice(0, chars).trimEnd()}…`;
  return all.length > lines ? `${kept}…` : kept;
}

export interface NoteGroup {
  /** The edition's id, or null for "No edition recorded" */
  editionId: string | null;
  label: string;
  notes: NoteEdit[];
}

/**
 * The book's notes by edition (SLN-480), in the Editions section's order
 * (`editionOrder`), "No edition recorded" last. The notes come in each
 * group's own order (getNotesForWork).
 */
export function noteGroups(notes: NoteEdit[], editionOrder: string[], editions: Record<string, NoteEdition>): NoteGroup[] {
  const groups: NoteGroup[] = editionOrder.map((id) => ({ editionId: id, label: editions[id]?.label ?? "Edition", notes: [] }));
  const none: NoteGroup = { editionId: null, label: "No edition recorded", notes: [] };
  for (const note of notes) (groups.find((g) => g.editionId === note.editionId) ?? none).notes.push(note);
  return [...groups, none].filter((g) => g.notes.length);
}

/** The anchor of an edition's group: the edition card's count links to it */
export const quotesAnchor = (editionId: string | null) => `quotes-edition-${editionId ?? "none"}`;
