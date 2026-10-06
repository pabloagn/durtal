"use server";

import { loadGoodreadsBooks } from "@/lib/export/reading";
import { goodreadsRow, roundsHalfStar } from "@/lib/export/goodreads";

/*
 * What the Goodreads export dialog says before downloading (SLN-458):
 * Goodreads takes whole stars, so a half-star rating the file carries is
 * rounded up. Only ratings the file carries count: a book never finished nor
 * abandoned goes out as 0.
 */
export async function getGoodreadsExportNotice(): Promise<{ books: number; halfStars: number }> {
  const books = (await loadGoodreadsBooks()).filter((book) => goodreadsRow(book) !== null);
  return { books: books.length, halfStars: books.filter(roundsHalfStar).length };
}
