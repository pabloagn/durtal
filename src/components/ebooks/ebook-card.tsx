import Link from "next/link";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { Library } from "lucide-react";
import { CardHeading } from "@/components/shared/card-heading";
import { FadeImage } from "@/components/shared/fade-image";
import { WORK_CARD, WORK_CARD_BODY } from "@/components/shared/work-card";
import { formatLabel } from "@/lib/ebooks/formats";
import type { EbookCardData } from "@/lib/ebooks/library-view";

export function EbookLinkedMark() {
  return (
    <Library
      size={14}
      strokeWidth={1.5}
      role="img"
      aria-label="Linked to its book"
      data-tooltip="Linked to its book"
    />
  );
}
export function EbookCover({
  book,
  sizes = "240px",
}: {
  book: EbookCardData;
  sizes?: string;
}) {
  return (
    <div className="relative aspect-[2/3] overflow-hidden bg-bg-tertiary">
      {book.cover ? (
        <FadeImage
          src={book.cover.src}
          srcSet={book.cover.srcSet}
          sizes={sizes}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <span
            aria-hidden="true"
            data-decorative
            className="font-serif text-3xl text-fg-muted/30"
          >
            {book.title[0]}
          </span>
        </div>
      )}
    </div>
  );
}
export function EbookCard({
  book,
  sizes,
  returnTo,
}: {
  book: EbookCardData;
  sizes?: string;
  /** Where the reader's Back goes */
  returnTo?: string;
}) {
  return (
    <article className={WORK_CARD} data-ebook-card={book.id}>
      <div className="relative">
        <Link
          href={`/ebooks/${book.id}`}
          aria-label={book.title}
          className="block cover-shadow"
        >
          <EbookCover book={book} sizes={sizes} />
        </Link>
        {book.readHref && (
          <ReaderEntryLink
            readerPath={book.readHref}
            returnTo={returnTo}
            className="absolute bottom-2 right-2 glass-chip rounded-sm px-3 py-2 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:min-h-11 pointer-coarse:opacity-100"
            aria-label={`Read ${book.title}`}
          >
            Read
          </ReaderEntryLink>
        )}
      </div>
      <div className={WORK_CARD_BODY}>
        <Link href={`/ebooks/${book.id}`}>
          <CardHeading
            title={book.title}
            subtitle={book.authors.join(", ") || "Unknown author"}
          />
        </Link>
        <div className="mt-auto flex min-h-5 flex-wrap items-center justify-between gap-2 pt-2.5 text-xs text-fg-secondary">
          <span>
            {book.formats.map(formatLabel).join(" · ") ||
              "No downloadable files"}
          </span>
          {book.linked && <EbookLinkedMark />}
        </div>
      </div>
    </article>
  );
}
