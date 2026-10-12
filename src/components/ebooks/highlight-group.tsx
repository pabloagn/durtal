import Link from "next/link";
import { EbookCover } from "./ebook-card";
import { Prose } from "@/components/shared/prose";
import { SectionHeading } from "@/components/shared/section-heading";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import type { EbookCardData } from "@/lib/ebooks/library-view";
import type { HighlightMark } from "@/lib/ebooks/highlights";

function markFill(mark: HighlightMark): string {
  if (mark.style === "quote" || !mark.color) return QUIET_GLASS_ANNOTATION_PALETTE.quote;
  return QUIET_GLASS_ANNOTATION_PALETTE.fills[mark.color];
}

function markPlace(mark: HighlightMark): string {
  return [
    mark.pageLabel ? `p. ${mark.pageLabel}` : `${Math.round(mark.progression * 100)}%`,
    mark.chapter,
    mark.updatedAt.slice(0, 10),
  ].filter(Boolean).join(" · ");
}

/**
 * One e-book's marks on /ebooks/highlights (SLN-500): the cover, title,
 * authors and count, then its newest marks, each opening the reader at it.
 */
export function HighlightGroup({
  book,
  total,
  marks,
  readerHref,
  moreHref,
}: {
  book: EbookCardData;
  total: number;
  marks: HighlightMark[];
  readerHref(markId: string): string;
  /** Every mark of this book, when more than these are kept by the filters */
  moreHref: string | null;
}) {
  return (
    <section className="flex gap-4" data-highlight-group={book.id}>
      <Link href={`/ebooks/${book.id}`} aria-label={book.title} className="block w-12 shrink-0 self-start cover-shadow sm:w-16">
        <EbookCover book={book} sizes="64px" />
      </Link>
      <div className="min-w-0 flex-1">
        <SectionHeading
          title={<Link href={`/ebooks/${book.id}`} className="[overflow-wrap:anywhere] hover:text-accent-primary">{book.title}</Link>}
          count={total}
          description={book.authors.join(", ") || "Unknown author"}
        />
        <ul className="flex flex-col gap-4">
          {marks.map((mark) => (
            <li key={mark.id} className="border-b border-glass-border pb-4">
              <div className="flex items-start gap-2">
                <span aria-hidden className="mt-1 block h-3 w-1 shrink-0 rounded-sm" style={{ backgroundColor: markFill(mark) }} />
                <div className="min-w-0 flex-1">
                  {mark.text ? (
                    <Prose>
                      <p className="line-clamp-3 whitespace-pre-wrap break-words text-fg-primary">{mark.text}</p>
                    </Prose>
                  ) : (
                    <p className="text-sm text-fg-primary">Bookmark</p>
                  )}
                  {mark.note && (
                    <Prose className="mt-2 text-fg-secondary">
                      <p className="whitespace-pre-wrap break-words">{mark.note}</p>
                    </Prose>
                  )}
                  <p className="mt-2 text-xs text-fg-secondary">
                    {markPlace(mark)}
                    {mark.anchorState === "orphaned" && " · Could not be placed"}
                  </p>
                  {mark.anchorState !== "orphaned" && (
                    <Link href={readerHref(mark.id)} className="mt-1 inline-block text-xs text-accent-primary touch-hit hover:underline">
                      Open in the reader
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {moreHref && (
          <Link href={moreHref} className="mt-3 inline-block text-sm text-accent-primary touch-hit hover:underline">
            All {total.toLocaleString("en-US")} in this book
          </Link>
        )}
      </div>
    </section>
  );
}
