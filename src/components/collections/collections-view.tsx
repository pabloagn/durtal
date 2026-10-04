"use client";

import { useViewModePreference } from "@/lib/hooks/use-preference";
import { LIST_PREFERENCES } from "@/lib/preferences";
import { ViewModeSwitcher } from "@/components/books/view-mode-switcher";
import { Mosaic, MosaicImage } from "@/components/shared/mosaic";
import { CoverFan, TitleCard } from "@/components/shared/no-photo";
import { mediaCrop } from "@/lib/utils/media-style";
import { CollectionCard, collectionPoster, type CollectionCardData } from "./collection-card";

const VIEW = LIST_PREFERENCES.collections.view;

function imageUrl(key: string) {
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

function useCollectionsView() {
  return useViewModePreference(VIEW.key, VIEW.modes, VIEW.fallback);
}

/** The view switch of the collections list: grid or mosaic */
export function CollectionsViewSwitcher() {
  const [view, setView] = useCollectionsView();
  return (
    <ViewModeSwitcher
      value={view}
      onChange={(mode) => {
        const next = VIEW.modes.find((m) => m === mode);
        if (next) setView(next);
      }}
      availableModes={VIEW.modes}
    />
  );
}

/** The collections in the saved view: cards, or a mosaic of their posters */
export function CollectionsView({
  collections,
}: {
  collections: { collection: CollectionCardData; covers: string[] }[];
}) {
  const [view] = useCollectionsView();
  if (view === "mosaic")
    return (
      <Mosaic
        aspect={2 / 3}
        perRow={7}
        items={collections.map(({ collection, covers }) => {
          const poster = collectionPoster(collection.media);
          return {
            key: collection.id,
            href: `/collections/${collection.id}`,
            title: collection.name,
            subtitle: collection.editionCount === 1 ? "1 book" : `${collection.editionCount} books`,
            aspect: 2 / 3,
            media: (
              <MosaicImage
                src={poster ? imageUrl(poster.thumbnailS3Key ?? poster.s3Key) : null}
                crop={poster ? mediaCrop(poster) : null}
                fallback={
                  covers.length ? <CoverFan covers={covers.map(imageUrl)} /> : <TitleCard title={collection.name} />
                }
              />
            ),
          };
        })}
      />
    );
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {collections.map(({ collection, covers }) => (
        <CollectionCard key={collection.id} collection={collection} covers={covers} />
      ))}
    </div>
  );
}
