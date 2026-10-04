"use client";

import { usePreference, useViewModePreference } from "@/lib/hooks/use-preference";
import { LIST_PREFERENCES } from "@/lib/preferences";
import { ViewModeSwitcher } from "@/components/books/view-mode-switcher";
import { GridSizeSlider } from "@/components/books/grid-size-slider";
import { COL_CLASSES } from "@/components/shared/grid-columns";
import { Mosaic, MosaicImage, mosaicPerRow } from "@/components/shared/mosaic";
import { CoverFan, TitleCard } from "@/components/shared/no-photo";
import { mediaCrop } from "@/lib/utils/media-style";
import { CollectionCard, collectionPoster, type CollectionCardData } from "./collection-card";

const VIEW = LIST_PREFERENCES.collections.view;
const GRID = LIST_PREFERENCES.collections.grid;

function imageUrl(key: string) {
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

function useCollectionsView() {
  return useViewModePreference(VIEW.key, VIEW.modes, VIEW.fallback);
}

function useCollectionsSize() {
  return usePreference(GRID.key, GRID.fallback);
}

/** The view switch of the collections list (grid or mosaic) and its size slider */
export function CollectionsViewSwitcher() {
  const [view, setView] = useCollectionsView();
  const [size, setSize] = useCollectionsSize();
  return (
    <div className="flex shrink-0 items-center gap-3">
      <ViewModeSwitcher
        value={view}
        onChange={(mode) => {
          const next = VIEW.modes.find((m) => m === mode);
          if (next) setView(next);
        }}
        availableModes={VIEW.modes}
      />
      <GridSizeSlider value={size} onChange={setSize} />
    </div>
  );
}

/** The collections in the saved view: cards, or a mosaic of their posters */
export function CollectionsView({
  collections,
}: {
  collections: { collection: CollectionCardData; covers: string[] }[];
}) {
  const [view] = useCollectionsView();
  const [size] = useCollectionsSize();
  if (view === "mosaic")
    return (
      <Mosaic
        aspect={2 / 3}
        perRow={mosaicPerRow(size)}
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
    <div className="@container">
      <div className={`grid gap-5 ${COL_CLASSES[size] ?? COL_CLASSES[GRID.fallback]}`}>
        {collections.map(({ collection, covers }) => (
          <CollectionCard key={collection.id} collection={collection} covers={covers} />
        ))}
      </div>
    </div>
  );
}
