import type { SimilarWork } from "@/lib/catalogue/related-tiles";
import { DomainTileCard } from "@/components/domains/domain-tile";
import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import { RelatedBookCard } from "./work-carousel";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";

export function SimilarWorksCarousel({ works, ebooks, readerReturnTo }: {
  works: SimilarWork[];
  ebooks?: ReadonlyMap<string, WorkEbookDTO | null>;
  readerReturnTo?: string;
}) {
  if (!works.length) return null;
  return (
    <HorizontalCarousel title="Similar Works">
      {works.map((work) => (
        <div key={work.id} className="carousel-card">
          {work.kind === "book" ? (
            <RelatedBookCard work={work.book} ebook={ebooks?.get(work.id) ?? null} readerReturnTo={readerReturnTo} />
          ) : (
            <DomainTileCard kind={work.kind} tile={work.tile} />
          )}
        </div>
      ))}
    </HorizontalCarousel>
  );
}
