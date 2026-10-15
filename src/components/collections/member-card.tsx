import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One member of a collection, whatever it is: an edition of a book, a whole
 * book, a film, a perfume or a painting. Every card has the same frame and
 * naturally wrapping text, with each row stretching to its tallest member; the image
 * in the frame keeps its collection's shape (a cover, a poster, a bottle, a
 * picture), whole. Each line follows the one above it with no blank line kept
 * for a short title or a missing fact; the actions sit at the card's foot.
 */
export function MemberCard({
  href,
  image,
  title,
  byline,
  facts,
  note,
  noteMono = false,
  actions,
  mark,
}: {
  href: string;
  /** The image, already shaped for its collection; it fills the frame's width */
  image: ReactNode;
  title: string;
  /** Authors, directors, house, painters */
  byline: string | null;
  /** Publisher and year, runtime and countries, concentrations, date and medium */
  facts: string | null;
  /** What is collected: "Paperback · 1998 edition", "The book, no edition chosen", "Film" */
  note: string | null;
  noteMono?: boolean;
  /** Copy and Read first, pulled out by their padding so the first icon sits
   * on the text's edge; the collection's own controls last, pushed right */
  actions: ReactNode;
  mark?: ReactNode;
}) {
  return (
    <article className="flex gap-4 rounded-sm border border-glass-border bg-bg-secondary p-4">
      {/* The title link is the card's tab stop; the image repeats it for the pointer */}
      <Link
        href={href}
        tabIndex={-1}
        aria-label={title}
        className="relative flex h-32 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-primary"
      >
        <div className="w-full">{image}</div>
        {mark}
      </Link>
      {/* Text grows with its content instead of clipping */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* A one-line title still takes a 44px press area on touch */}
        <Link href={href} className="touch-hit block [overflow-wrap:anywhere] type-item-title">
          {title}
        </Link>
        {byline && <p className="mt-1 [overflow-wrap:anywhere] text-sm text-fg-secondary">{byline}</p>}
        {(facts || note) && (
          <div className="mt-2 space-y-1 text-xs text-fg-secondary">
            {facts && <p className="[overflow-wrap:anywhere]">{facts}</p>}
            {note && <p className={`[overflow-wrap:anywhere] ${noteMono ? "font-mono" : ""}`}>{note}</p>}
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {actions}
        </div>
      </div>
    </article>
  );
}
