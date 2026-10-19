import type { ReactNode } from "react";
import type { RelatedBook } from "@/lib/catalogue/related-books";
import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import { BookCard } from "@/components/books/book-card";
import { mediaCrop } from "@/lib/utils/media-style";
import { cardReadingOf } from "@/lib/reading/card";
import { mediaUrl } from "@/lib/s3/media-url";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";

/** A work loaded with `workCardWith` */
export type WorkCardData = RelatedBook;

/** Book-only presentation also used inside a mixed related shelf. */
export function RelatedBookCard({ work, ebook, readerReturnTo }: {
  work: WorkCardData;
  ebook: WorkEbookDTO | null;
  readerReturnTo?: string;
}) {
  const edition = work.editions[0];
  const poster = work.media?.find((m) => m.type === "poster" && m.isActive);
  const coverKey =
    poster?.thumbnailS3Key ??
    poster?.s3Key ??
    edition?.thumbnailS3Key ??
    edition?.coverS3Key;
  const authorNames = [
    ...new Set(work.workAuthors.map((wa) => wa.author.name)),
  ];
  return (
    <BookCard
      workId={work.id}
      slug={work.slug ?? ""}
      title={work.title}
      authorName={authorNames.join(", ") || "Unknown author"}
      authorNames={authorNames}
      editionNote={work.editionNote}
      primaryEditionId={edition?.id}
      coverUrl={coverKey ? mediaUrl(coverKey) : null}
      coverCrop={poster ? mediaCrop(poster) : null}
      coverTone={poster?.tone ?? null}
      publicationYear={edition?.publicationYear ?? work.originalYear}
      language={edition?.language}
      instanceCount={work.copyCount}
      rating={work.rating}
      catalogueStatus={work.catalogueStatus}
      acquisitionPriority={work.acquisitionPriority}
      isRare={work.isRare}
      huntAssessedOn={work.huntAssessedOn}
      isPoison={work.isPoison}
      isFavourite={work.isFavourite}
      reading={cardReadingOf(work)}
      ebook={ebook}
      readerReturnTo={readerReturnTo}
    />
  );
}

/**
 * A titled row of book cards on a detail page ("More by …", similar works).
 * `caption` identifies a series volume; similarity has no captions.
 */
export function WorkCarousel<T extends WorkCardData>({
  title,
  titleHref,
  count,
  works,
  caption,
  ebooks,
  readerReturnTo,
}: {
  title: string;
  titleHref?: string;
  /** Shown after the title */
  count?: number;
  works: T[];
  caption?: (work: T) => ReactNode;
  /** Each work's readable e-book; a work missing from it has none */
  ebooks: ReadonlyMap<string, WorkEbookDTO | null>;
  readerReturnTo?: string;
}) {
  return (
    <HorizontalCarousel title={title} titleHref={titleHref} count={count}>
      {works.map((work) => (
        <div key={work.id} className="carousel-card">
          <RelatedBookCard work={work} ebook={ebooks.get(work.id) ?? null} readerReturnTo={readerReturnTo} />
          {caption?.(work)}
        </div>
      ))}
    </HorizontalCarousel>
  );
}
