import { n } from "@/lib/reading/charts";
import type { LibraryNumbers } from "./library";

/*
 * The library's number tiles, one list for the dashboard's Statistics and
 * /statistics (SLN-1184), so a figure reads the same in both.
 */

const LABELS: Record<keyof LibraryNumbers, string> = {
  books: "Books",
  editions: "Editions",
  copies: "Owned copies",
  pages: "Pages",
  authors: "Authors",
  publishers: "Publishers",
  languages: "Languages",
  // Named as on the dashboard's index (SLN-886)
  countries: "Authors' countries",
};

/** One tile. No page count is not zero pages (SLN-824): a dash, and the tile stays so the rows end full */
export function libraryTile(key: keyof LibraryNumbers, numbers: LibraryNumbers, label = LABELS[key]) {
  if (key === "pages" && numbers.pages <= 0) return { label: "No page counts yet", value: "\u2014" };
  return { label, value: n(numbers[key]) };
}

/** What both views say before a book is owned */
export const NO_OWNED_BOOKS = {
  title: "No books on your shelves yet",
  description: "These numbers count the books you own: those with a copy in one of your locations.",
} as const;
