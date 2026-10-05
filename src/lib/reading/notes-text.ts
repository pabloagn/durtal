/*
 * The commonplace book's text rules (SLN-453). Pure: the page, the dialog and
 * the tests share them.
 */

/**
 * Joins a word that a pasted page broke over two lines: "melan-\ncholy"
 * becomes "melancholy" when the next line starts with a lower-case letter.
 * "Saint-\nSimon" keeps its hyphen and its line break, and so does a hyphen
 * at the end of the text. Other line breaks stay.
 */
export function joinHyphenatedLines(text: string): string {
  return text.replace(/(\p{L})-[ \t]*\r?\n[ \t]*(?=\p{Ll})/gu, "$1");
}

export interface CopyNote {
  body: string;
  page: number | null;
  chapter: string | null;
}

export interface CopyBook {
  title: string;
  author: string | null;
}

/**
 * The clipboard text of a quote or note: the passage in double quotes, a new
 * line, then "Author, Title, p. 212" (", ch. 7" when there is a chapter and
 * no page; nothing after the title when neither is known).
 */
export function formatNoteForCopy(note: CopyNote, book: CopyBook): string {
  const where = note.page != null ? `, p. ${note.page}` : note.chapter ? `, ch. ${note.chapter}` : "";
  const source = [book.author, book.title].filter(Boolean).join(", ");
  return `“${note.body.trim()}”\n${source}${where}`;
}

/** "p. 212 · ch. 7", "ch. 7", "44%", or null */
export function noteWhereText(note: { page: number | null; chapter: string | null; percent: number | null }): string | null {
  const parts = [note.page != null ? `p. ${note.page}` : note.percent != null ? `${Math.round(note.percent)}%` : null, note.chapter ? `ch. ${note.chapter}` : null];
  const text = parts.filter(Boolean).join(" · ");
  return text || null;
}

/** "12 quotes and 2 notes", "1 quote", "3 notes"; empty for none */
export function notesCountText(quotes: number, notes: number): string {
  const parts = [quotes ? `${quotes} ${quotes === 1 ? "quote" : "quotes"}` : null, notes ? `${notes} ${notes === 1 ? "note" : "notes"}` : null];
  return parts.filter(Boolean).join(" and ");
}

/** The first `lines` lines of a text, with an ellipsis when there is more */
export function firstLines(text: string, lines = 3): string {
  const all = text.trim().split(/\r?\n/);
  return all.length > lines ? `${all.slice(0, lines).join("\n")}…` : all.join("\n");
}
