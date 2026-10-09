import type { SimilarWork } from "@/lib/catalogue/related-tiles";
import { DomainTileCard } from "@/components/domains/domain-tile";
import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import { RelatedBookCard } from "./work-carousel";

export function SimilarWorksCarousel({ works }: { works: SimilarWork[] }) {
  if (!works.length) return null;
  return (
    <HorizontalCarousel title="Similar Works">
      {works.map((work) => (
        <div key={work.id} className="carousel-card">
          {work.kind === "book" ? (
            <RelatedBookCard work={work.book} />
          ) : (
            <DomainTileCard kind={work.kind} tile={work.tile} />
          )}
        </div>
      ))}
    </HorizontalCarousel>
  );
}
