import { formatRating } from "@/lib/utils/rating";
import type { SuggestBook, SuggestContext } from "./types";

/*
 * Worth re-reading (SLN-457): books finished at least five years ago that he
 * rated 4.5 or more (taste evidence) or marked favourite, with no reading
 * started since that finish.
 */

export const REREAD_YEARS = 5;
export const REREAD_MIN_RATING = 4.5;

export interface Reread {
  book: SuggestBook;
  text: string;
}

export function worthRereading(ctx: Pick<SuggestContext, "books" | "today">): Reread[] {
  const before = `${Number(ctx.today.slice(0, 4)) - REREAD_YEARS}${ctx.today.slice(4)}`;
  return ctx.books
    .filter(
      (b) =>
        b.finishedCount > 0 &&
        !b.open &&
        !b.readSinceFinish &&
        b.lastFinishedOn !== null &&
        b.lastFinishedOn <= before &&
        ((b.taste !== null && b.taste >= REREAD_MIN_RATING) || b.isFavourite) &&
        b.feedback?.verdict !== "never" &&
        b.feedback?.verdict !== "rejected",
    )
    .sort((a, b) => (b.taste ?? 0) - (a.taste ?? 0) || a.lastFinishedOn!.localeCompare(b.lastFinishedOn!))
    .map((book) => {
      const year = book.lastFinishedOn!.slice(0, 4);
      return {
        book,
        text:
          book.taste !== null && book.taste >= REREAD_MIN_RATING
            ? `You gave ${book.title} ${formatRating(book.taste)} in ${year}. Read it again?`
            : `${book.title} is a favourite, last read in ${year}. Read it again?`,
      };
    });
}
