import Link from "next/link";
import { n } from "@/lib/reading/charts";
import { yearLabel } from "@/lib/statistics/charts";
import { FadeImage } from "@/components/shared/fade-image";
import { mediaUrl } from "@/lib/s3/media-url";
import type { BusiestYear, CoverBook } from "@/lib/statistics/library";

/*
 * Books on the statistics pages as their covers (SLN-742): where the page
 * names books, it shows them. A cover links to its book; its title and
 * author are its name for a screen reader and its tooltip.
 */

export const bookHref = (book: CoverBook) => `/library/${book.slug ?? book.workId}`;
const name = (book: CoverBook) => (book.author ? `${book.title}, ${book.author}` : book.title);

/** A cover at the width of its column, in the book cover's 2:3 frame */
export function CoverLink({ book }: { book: CoverBook }) {
  return (
    <Link href={bookHref(book)} aria-label={name(book)} data-tooltip={name(book)} className="cover-shadow block transition-transform hover:-translate-y-0.5" data-stats-cover="">
      <CoverFrame book={book} />
    </Link>
  );
}

/** The cover alone, for inside a link */
export function CoverFrame({ book }: { book: CoverBook }) {
  return (
    <span className="relative block aspect-[2/3] overflow-hidden bg-bg-tertiary">
      {book.cover ? (
        <FadeImage
          src={mediaUrl(book.cover, { width: 240 })}
          alt=""
          loading="lazy"
          decoding="async"
          className="protected-image absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        // The title's letter, as every blank cover (#352); decoration: the title is the link's name
        <span className="@container/cover absolute inset-0 flex items-center justify-center">
          <span aria-hidden data-decorative className="font-serif text-xs leading-none text-fg-muted/30 @[56px]/cover:text-lg @[120px]/cover:text-3xl">
            {Array.from(book.title.trim())[0] ?? ""}
          </span>
        </span>
      )}
    </span>
  );
}

/** A row of covers, side by side, overlapping a little: the head of a statistics page */
export function CoverStrip({ books }: { books: CoverBook[] }) {
  const shown = books.filter((b) => b.cover).slice(0, 5);
  if (shown.length < 3) return null;
  return (
    <div className="flex justify-center" aria-hidden data-stats-strip="">
      {shown.map((book, i) => (
        <div
          key={book.workId}
          className="cover-shadow relative w-[22%] max-w-36 shrink-0 [&+&]:-ml-[4%]"
          // The middle cover on top, the outer ones under it
          style={{ zIndex: shown.length - Math.abs(i - Math.floor(shown.length / 2)) }}
        >
          <CoverFrame book={book} />
        </div>
      ))}
    </div>
  );
}

/** The library's list of the books he owns from one year */
export const yearHref = (year: number) => `/library?yearFrom=${year}&yearTo=${year}&holding=owned`;

/**
 * A year with many books: the year, linked to its books, and their count,
 * beside up to five of its covers. The cover column keeps five slots, so
 * the covers are the same size in every year's row.
 */
export function YearCovers({ year, caption }: { year: BusiestYear; /** Where no heading says what the year is */ caption?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[8rem_1fr]" data-stats-year={year.year}>
      <div>
        {caption && <p className="type-caption mb-1">{caption}</p>}
        <Link href={yearHref(year.year)} className="type-stat block text-fg-primary transition-colors hover:text-accent-primary">
          {yearLabel(year.year)}
        </Link>
        <p className="text-xs text-fg-secondary">
          {n(year.books)} {year.books === 1 ? "book" : "books"}
        </p>
      </div>
      <ul className="grid max-w-[44rem] grid-cols-5 gap-2 sm:gap-3">
        {year.covers.map((book) => (
          <li key={book.workId}>
            <CoverLink book={book} />
          </li>
        ))}
      </ul>
    </div>
  );
}
