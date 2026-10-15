import Link from "next/link";
import { FadeImage } from "@/components/shared/fade-image";
import { mediaUrl } from "@/lib/s3/media-url";
import type { CoverBook } from "@/lib/statistics/library";

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
        // Decoration: the title is the link's name
        <span aria-hidden data-decorative className="absolute inset-0 flex items-center justify-center font-serif text-2xl text-fg-muted/40">
          {book.title[0]}
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
