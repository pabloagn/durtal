import type { ReactNode } from "react";
import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import { CollectionCard, collectionPoster } from "@/components/collections/collection-card";
import { getCollectionCoverPreviews, getCollectionsForWork } from "@/lib/actions/collections";

type WorkCollection = Awaited<ReturnType<typeof getCollectionsForWork>>[number];
type CoverPreview = Awaited<ReturnType<typeof getCollectionCoverPreviews>>[number];

/** The collections holding a work, and the member covers of those without a poster */
export async function loadWorkCollections(workId: string) {
  const collections = await getCollectionsForWork(workId);
  const covers = await getCollectionCoverPreviews(
    collections.filter((c) => !collectionPoster(c.media)).map((c) => c.id),
  );
  return { collections, covers };
}

/**
 * The Collections section of a book, film, perfume or painting page: a card
 * for each collection holding it, none when it is in no collection (SLN-916)
 */
export function WorkCollectionsSection({
  collections,
  covers,
  footer,
}: {
  collections: WorkCollection[];
  covers: CoverPreview[];
  /** What the card's info row adds, such as which editions it holds */
  footer?: (collection: WorkCollection) => ReactNode;
}) {
  if (!collections.length) return null;
  return (
    <section className="mb-8">
      <HorizontalCarousel title="Collections" titleHref="/collections">
        {collections.map((collection) => (
          <div key={collection.id} className="carousel-card">
            <CollectionCard
              collection={collection}
              covers={covers.filter((p) => p.collectionId === collection.id).map((p) => p.s3Key)}
              footer={footer?.(collection)}
            />
          </div>
        ))}
      </HorizontalCarousel>
    </section>
  );
}
