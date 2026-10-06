import type { NoteKind } from "@/lib/reading/constants";
import { noteWhereText, notesCountText } from "@/lib/reading/notes-text";
import type { NoteEdition } from "@/lib/reading/edition-label";

/*
 * The commonplace book as Markdown (SLN-458): one heading per book (title,
 * then its author), the passages in page order, each with its page and
 * chapter, his thought under it, favourites marked. Pure: the export route
 * passes the notes in book and page order.
 */

export interface CommonplaceNote {
  workId: string;
  title: string;
  author: string | null;
  kind: NoteKind;
  body: string;
  /** His thought about a quote, as plain text */
  thought: string | null;
  page: number | null;
  /** The last page of a passage over a page turn, and whether the pages are roman (SLN-480) */
  endPage: number | null;
  pageRoman: boolean;
  chapter: string | null;
  percent: number | null;
  isFavourite: boolean;
  /** The edition, named by its short label; null without one */
  edition: NoteEdition | null;
}

/** Text that Markdown would read as markup keeps its characters: \, *, _ and ` are escaped, and a line that starts a heading, list or quote */
function plain(text: string): string {
  return text
    .replace(/[\\*_`]/g, (c) => `\\${c}`)
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#>+-]|\d+\.)(?=\s|$)/, "$1\\$2"))
    .join("\n");
}

/** "6 October 2026" */
function longDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function commonplaceMarkdown(notes: CommonplaceNote[], today: string): string {
  const quotes = notes.filter((n) => n.kind === "quote").length;
  const count = notesCountText(quotes, notes.length - quotes) || "No quotes or notes";
  const books = new Set(notes.map((n) => n.workId)).size;
  const lines = [
    "# Commonplace book",
    "",
    `Exported from Durtal on ${longDay(today)}: ${count}${books ? ` from ${books} ${books === 1 ? "book" : "books"}` : ""}.`,
  ];
  let book: string | null = null;
  for (const note of notes) {
    if (note.workId !== book) {
      book = note.workId;
      lines.push("", `## ${plain(note.title)}`);
      if (note.author) lines.push("", plain(note.author));
    }
    // "p. 212 · Penguin Classics, 2003 · ch. 7", as the pages cite a note
    const place = noteWhereText(note, note.edition ?? undefined);
    const where = [note.kind === "note" ? "Note" : null, place, note.isFavourite ? "★ Favourite" : null].filter(Boolean).join(" · ");
    if (note.kind === "quote") {
      lines.push("", ...plain(note.body.trim()).split("\n").map((line) => (line ? `> ${line}` : ">")));
      if (where) lines.push("", where);
    } else {
      if (where) lines.push("", where);
      lines.push("", plain(note.body.trim()));
    }
    if (note.thought?.trim()) lines.push("", plain(note.thought.trim()));
  }
  return `${lines.join("\n")}\n`;
}
