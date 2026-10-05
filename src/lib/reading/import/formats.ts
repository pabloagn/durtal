import type { ImportSource } from "./types";

/** The full Goodreads export header, in Goodreads' order: the fixtures and a later step's export use it */
export const GOODREADS_EXPORT_HEADER = [
  "Book Id",
  "Title",
  "Author",
  "Author l-f",
  "Additional Authors",
  "ISBN",
  "ISBN13",
  "My Rating",
  "Average Rating",
  "Publisher",
  "Binding",
  "Number of Pages",
  "Year Published",
  "Original Publication Year",
  "Date Read",
  "Date Added",
  "Bookshelves",
  "Bookshelves with positions",
  "Exclusive Shelf",
  "My Review",
  "Spoiler",
  "Private Notes",
  "Read Count",
  "Owned Copies",
] as const;

export class UnknownFormatError extends Error {
  constructor(headers: string[]) {
    const shown = headers.slice(0, 12).map((h) => h.slice(0, 40)).join(", ");
    super(`This file is not a Goodreads, StoryGraph or Durtal export. Its columns: ${shown || "none"}`);
  }
}

/** The file's format by its header names, never by column position */
export function detectFormat(headers: string[]): ImportSource {
  const has = (...names: string[]) => names.every((n) => headers.includes(n));
  if (has("work_id", "source_key")) return "durtal";
  if (has("Title", "Exclusive Shelf", "My Rating")) return "goodreads";
  if (has("Read Status", "Star Rating")) return "storygraph";
  throw new UnknownFormatError(headers);
}
