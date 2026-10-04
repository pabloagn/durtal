import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One member of a collection, whatever it is: an edition of a book, a whole
 * book, a film, a perfume or a painting. Every card has the same frame and
 * fixed text lines, so a mixed collection keeps one height per row; the image
 * in the frame keeps its collection's shape (a cover, a poster, a bottle, a
 * picture), whole.
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
  actions: ReactNode;
}) {
  return (
    <article className="flex gap-4 rounded-sm border border-glass-border bg-bg-secondary p-4">
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden
        className="flex h-32 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-primary"
      >
        <div className="w-full">{image}</div>
      </Link>
      {/* Fixed lines: every member card has the same height */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={href} className="lines-2 type-item-title">
          {title}
        </Link>
        <p className="mt-1 lines-1 text-sm text-fg-secondary">{byline}</p>
        <p className="mt-2 lines-1 text-xs text-fg-secondary">{facts}</p>
        <p
          className={`mt-1 lines-1 text-xs text-fg-secondary ${noteMono ? "font-mono" : ""}`}
        >
          {note}
        </p>
        <div className="mt-auto flex items-center justify-between pt-3">
          {actions}
        </div>
      </div>
    </article>
  );
}
