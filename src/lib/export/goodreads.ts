import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { bindingLabel } from "@/lib/utils/binding";
import { stripHtmlToText } from "@/lib/utils/sanitize";
import type { ReadingDatePrecision } from "@/lib/reading/constants";

/*
 * The Goodreads-compatible file (SLN-458): one row per book, in Goodreads'
 * own export header, which StoryGraph imports too. Pure: `loadGoodreadsBooks`
 * (`./reading.ts`) reads the facts, this turns them into cells. The file is
 * lossy by design: half stars round up, only day-precision dates go out,
 * earlier finishes and abandoned attempts on a read book are not shown.
 */

export type GoodreadsColumn = (typeof GOODREADS_EXPORT_HEADER)[number];
export type GoodreadsRow = Record<GoodreadsColumn, string | number>;

/** What one book's row is made from */
export interface GoodreadsBook {
  title: string;
  /** In credit order: name and sort name ("Gaddis, William") */
  authors: { name: string; sortName: string | null }[];
  originalYear: number | null;
  /** The book's rating, 0.5 to 5 */
  rating: number | null;
  /** The book's creation day, YYYY-MM-DD */
  createdOn: string;
  /** readingStateSql */
  state: "unread" | "reading" | "paused" | "read" | "abandoned";
  inUpNext: boolean;
  /** Finished readings */
  readCount: number;
  /** Abandoned readings */
  abandonedCount: number;
  /** The latest finished reading's finish date, its precision and review */
  lastFinishedOn: string | null;
  lastFinishedPrecision: ReadingDatePrecision | null;
  lastReviewHtml: string | null;
  /** The latest abandoned reading's stop date and precision */
  lastAbandonedOn: string | null;
  lastAbandonedPrecision: ReadingDatePrecision | null;
  /** The edition of the latest reading, else the first edition */
  edition: {
    isbn10: string | null;
    isbn13: string | null;
    publisher: string | null;
    binding: string | null;
    pageCount: number | null;
    publicationYear: number | null;
  } | null;
  /** The Goodreads id sources, in the order they are tried */
  goodreadsIds: {
    latestEdition: string | null;
    anyEdition: string | null;
    identifier: string | null;
    url: string | null;
  };
  /** The book's copies that are not deaccessioned */
  ownedCopies: number;
}

/** The book's shelf, or null when it does not go in the file */
export function goodreadsShelf(book: Pick<GoodreadsBook, "state" | "inUpNext">): string | null {
  if (book.state === "reading" || book.state === "paused") return "currently-reading";
  if (book.state === "read") return "read";
  if (book.state === "abandoned") return "did-not-finish";
  return book.inUpNext ? "to-read" : null;
}

/** A rating Goodreads accepts: whole stars, a half rounded up; 0 for none */
export function goodreadsStars(rating: number | null): number {
  return rating ? Math.ceil(rating) : 0;
}

/** The rating the file carries: none for a book never finished nor abandoned (it may be a priority the seed stored as a rating) */
function carriedRating(book: Pick<GoodreadsBook, "rating" | "readCount" | "abandonedCount">): number | null {
  return book.readCount > 0 || book.abandonedCount > 0 ? book.rating : null;
}

/** The book's rating would lose its half star in the file */
export function roundsHalfStar(book: Pick<GoodreadsBook, "rating" | "readCount" | "abandonedCount">): boolean {
  const rating = carriedRating(book);
  return rating !== null && !Number.isInteger(rating);
}

/** The digits of a Goodreads id: from an id or a /book/show/<id> link */
function goodreadsId(value: string | null): string | null {
  if (!value) return null;
  const fromUrl = value.match(/\/book\/show\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(value.trim()) ? value.trim() : null;
}

/** YYYY-MM-DD → YYYY/MM/DD, at day precision only */
const slashDay = (on: string | null, precision: ReadingDatePrecision | null = "day") =>
  on && precision === "day" ? on.slice(0, 10).replace(/-/g, "/") : "";

export function goodreadsRow(book: GoodreadsBook): GoodreadsRow | null {
  const shelf = goodreadsShelf(book);
  if (!shelf) return null;
  const [first, ...others] = book.authors;
  const ids = book.goodreadsIds;
  const dateRead =
    shelf === "did-not-finish"
      ? slashDay(book.lastAbandonedOn, book.lastAbandonedPrecision)
      : slashDay(book.lastFinishedOn, book.lastFinishedPrecision);
  const e = book.edition;
  return {
    "Book Id": goodreadsId(ids.latestEdition) ?? goodreadsId(ids.anyEdition) ?? goodreadsId(ids.identifier) ?? goodreadsId(ids.url) ?? "",
    Title: book.title,
    Author: first?.name ?? "",
    "Author l-f": first ? (first.sortName ?? first.name) : "",
    "Additional Authors": others.map((a) => a.name).join(", "),
    ISBN: e?.isbn10?.replace(/[^0-9X]/gi, "") ?? "",
    ISBN13: e?.isbn13?.replace(/\D/g, "") ?? "",
    "My Rating": goodreadsStars(carriedRating(book)),
    "Average Rating": "",
    Publisher: e?.publisher ?? "",
    Binding: bindingLabel(e?.binding) ?? "",
    "Number of Pages": e?.pageCount ?? "",
    "Year Published": e?.publicationYear ?? "",
    "Original Publication Year": book.originalYear ?? "",
    "Date Read": dateRead,
    "Date Added": slashDay(book.createdOn),
    Bookshelves: book.state === "paused" ? `${shelf}, paused` : shelf,
    "Bookshelves with positions": "",
    "Exclusive Shelf": shelf,
    "My Review": book.lastReviewHtml ? stripHtmlToText(book.lastReviewHtml).trim() : "",
    Spoiler: "",
    "Private Notes": "",
    "Read Count": book.readCount,
    "Owned Copies": book.ownedCopies,
  };
}
