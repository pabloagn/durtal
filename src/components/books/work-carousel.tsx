import type { ReactNode } from "react";
import type { RelatedBook } from "@/lib/catalogue/related-books";
import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import { BookCard } from "@/components/books/book-card";
import { mediaCrop } from "@/lib/utils/media-style";
import { cardReadingOf } from "@/lib/reading/card";
import { mediaUrl } from "@/lib/s3/media-url";

/** A work loaded with `workCardWith` */
export type WorkCardData = RelatedBook;

/** Book-only presentation also used inside a mixed related shelf. */
export function RelatedBookCard({ work }: { work: WorkCardData }) {
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
      instanceCount={edition?.instances?.length ?? 0}
      rating={work.rating}
      catalogueStatus={work.catalogueStatus}
      acquisitionPriority={work.acquisitionPriority}
      isRare={work.isRare}
      huntAssessedOn={work.huntAssessedOn}
      isPoison={work.isPoison}
      isFavourite={work.isFavourite}
      reading={cardReadingOf(work)}
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
  works,
  caption,
}: {
  title: string;
  titleHref?: string;
  works: T[];
  caption?: (work: T) => ReactNode;
}) {
  return (
    <HorizontalCarousel title={title} titleHref={titleHref}>
      {works.map((work) => (
        <div key={work.id} className="carousel-card">
          <RelatedBookCard work={work} />
          {caption?.(work)}
        </div>
      ))}
    </HorizontalCarousel>
  );
}
