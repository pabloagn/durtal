import type { ReactNode } from "react";
import type { getWorksByAuthorId } from "@/lib/actions/works";
import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import { BookCard } from "@/components/books/book-card";
import { mediaCrop } from "@/lib/utils/media-style";
import { cardReadingOf } from "@/lib/reading/card";
import { mediaUrl } from "@/lib/s3/media-url";

/** A work loaded with `workCardWith` */
export type WorkCardData = Awaited<
  ReturnType<typeof getWorksByAuthorId>
>[number];

/**
 * A titled row of book cards on a detail page ("More by …", similar works).
 * `caption` adds a line under a card, such as why the book is listed.
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
      {works.map((work) => {
        const edition = work.editions[0];
        const poster = work.media?.find(
          (m) => m.type === "poster" && m.isActive,
        );
        const coverKey =
          poster?.thumbnailS3Key ?? poster?.s3Key ?? edition?.thumbnailS3Key;
        return (
          <div key={work.id} className="w-[160px] flex-shrink-0 snap-start">
            <BookCard
              workId={work.id}
              slug={work.slug ?? ""}
              title={work.title}
              authorName={work.workAuthors[0]?.author?.name ?? "Unknown"}
              authorNames={work.workAuthors.map((wa) => wa.author.name)}
              coverUrl={
                coverKey
                  ? mediaUrl(coverKey)
                  : null
              }
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
            {caption?.(work)}
          </div>
        );
      })}
    </HorizontalCarousel>
  );
}
