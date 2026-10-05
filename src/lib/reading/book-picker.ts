/*
 * The book picker's "Not in Durtal?" link (SLN-448): the add-a-book page with
 * the query (or the ISBN) and the dialog to open once the book exists.
 */

export type PickerPurpose = "start" | "past";

export const PICKER_PURPOSES: readonly PickerPurpose[] = ["start", "past"];

/** The digits of an ISBN-10 or ISBN-13 once spaces and hyphens go; null when it is not one */
export function isbnOf(text: string): string | null {
  const s = text.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(s) || /^\d{9}[\dX]$/.test(s)) return s;
  return null;
}

/** "/library/new?q=Dune&then=start", or "?isbn=9780441013593&then=past" for an ISBN */
export function bookPickerAddHref(query: string, then: PickerPurpose): string {
  const q = query.trim().slice(0, 200);
  const isbn = isbnOf(q);
  const params = new URLSearchParams();
  if (isbn) params.set("isbn", isbn);
  else if (q) params.set("q", q);
  params.set("then", then);
  return `/library/new?${params.toString()}`;
}

/** The add-a-book page's parameters, each kept only when valid */
export function addBookParams(params: { q?: string | string[]; isbn?: string | string[]; then?: string | string[] }) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = one(params.q)?.trim().slice(0, 200) || null;
  const isbn = isbnOf(one(params.isbn) ?? "");
  const then = one(params.then);
  return {
    initialQuery: q,
    initialIsbn: isbn,
    then: then === "start" || then === "past" ? (then as PickerPurpose) : null,
  };
}

/** "Reading 44%", "Paused", "Read 2 times"; nothing for an unread book */
export function pickerReadingState(book: { state: string; reads: number; percent: number | null }): string | null {
  if (book.state === "reading") return book.percent != null ? `Reading ${Math.round(book.percent)}%` : "Reading";
  if (book.state === "paused") return "Paused";
  if (book.state === "abandoned") return "Abandoned";
  if (book.state === "read") return book.reads > 1 ? `Read ${book.reads} times` : "Read";
  return null;
}
