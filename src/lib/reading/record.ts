/*
 * "Read 7 of 12" and the Reading record of a list of books (SLN-449): an
 * author's books, a series' volumes. Read is at least one finished reading,
 * so a book being re-read counts. Ratings are the books' own.
 */

export interface BookReadingFacts {
  timesRead: number;
  rating?: number | string | null;
  lastReadAt?: string | null;
}

export function readingRecordOf(books: BookReadingFacts[]) {
  const read = books.filter((b) => Number(b.timesRead) >= 1).length;
  const rereads = books.filter((b) => Number(b.timesRead) >= 2).length;
  const rated = books.map((b) => (b.rating === null || b.rating === undefined ? null : Number(b.rating))).filter((r): r is number => r !== null);
  const average = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null;
  const lastReadAt = books.map((b) => b.lastReadAt ?? null).filter((d): d is string => !!d).sort().at(-1) ?? null;
  return { total: books.length, read, rereads, average, lastReadAt };
}

/** "Read 7 of 12"; nothing when no book is read */
export function readOfText(record: { total: number; read: number }) {
  return record.read ? `Read ${record.read} of ${record.total}` : null;
}

/** The author page's tabs: All, Unread, Reading (or paused), Read */
export const AUTHOR_READING_TABS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "reading", label: "Reading" },
  { value: "read", label: "Read" },
] as const;
export type AuthorReadingTab = (typeof AUTHOR_READING_TABS)[number]["value"];

export function authorReadingTabOf(value: string | string[] | undefined): AuthorReadingTab {
  const v = Array.isArray(value) ? value[0] : value;
  return AUTHOR_READING_TABS.some((t) => t.value === v) ? (v as AuthorReadingTab) : "all";
}

/** A book in a tab, by its reading state (`readingStateSql`) */
export function inReadingTab(tab: AuthorReadingTab, state: string | null | undefined) {
  if (tab === "all") return true;
  if (tab === "reading") return state === "reading" || state === "paused";
  return state === tab;
}
