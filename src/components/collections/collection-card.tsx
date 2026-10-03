import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import { CollectionIcon } from "./collection-icon";
import { CapAligned } from "@/components/shared/cap-aligned";
import { FadeImage } from "@/components/shared/fade-image";

type ArtworkRow = {
  type: string;
  isActive: boolean;
  s3Key: string;
  thumbnailS3Key: string | null;
  cropX: number;
  cropY: number;
  cropZoom: number;
  brightness: number;
  contrast: number;
};

export interface CollectionCardData {
  id: string;
  name: string;
  icon?: string | null;
  description?: string | null;
  editionCount: number;
  media?: ArtworkRow[];
}

function imageUrl(key: string) {
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

/** The active poster row of a collection, if any. */
export function collectionPoster(media: ArtworkRow[] | undefined) {
  return media?.find((m) => m.type === "poster" && m.isActive) ?? null;
}

/** The active background row of a collection, if any. */
export function collectionBackground(media: ArtworkRow[] | undefined) {
  return media?.find((m) => m.type === "background" && m.isActive) ?? null;
}

/**
 * Collection card for grids and carousels. The active poster always leads,
 * framed with its saved crop; member covers form a collage only when there is
 * no poster.
 */
export function CollectionCard({
  collection,
  covers = [],
  footer,
}: {
  collection: CollectionCardData;
  /** Member cover keys (first four), used only without a poster */
  covers?: string[];
  /** Short text in the info row, e.g. which of the book's editions it holds */
  footer?: React.ReactNode;
}) {
  const poster = collectionPoster(collection.media);
  const count = collection.editionCount;
  return (
    <div className="group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link
        href={`/collections/${collection.id}`}
        aria-label={`Open ${collection.name}`}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="relative aspect-[2/3] overflow-hidden rounded-t-sm bg-bg-tertiary">
        {poster ? (
          <FadeImage
            src={imageUrl(poster.thumbnailS3Key ?? poster.s3Key)}
            alt={collection.name}
            loading="lazy"
            className="protected-image h-full w-full object-cover group-hover:scale-[1.02]"
            style={mediaImageStyle(mediaCrop(poster))}
          />
        ) : covers.length ? (
          <div
            className={`grid h-full ${covers.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {covers.map((key, index) => (
              <FadeImage
                key={key}
                src={imageUrl(key)}
                alt=""
                loading="lazy"
                className={`h-full min-h-0 w-full object-cover ${covers.length === 3 && index === 2 ? "col-span-2" : ""}`}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <FolderOpen className="h-8 w-8 text-fg-muted/20" strokeWidth={1} />
            <span className="font-serif text-sm text-fg-muted/30">
              {collection.name[0]}
            </span>
          </div>
        )}

        {poster && (
          <div className="absolute right-2 top-2 z-20">
            <ImageAdjustButton
              source={imageUrl(poster.s3Key)}
              label="Adjust collection poster"
            />
          </div>
        )}
      </div>

      {/* The book card's layout, line for line: 2-line title, 1 line of
          text, 1 info row. Collection and book cards are the same height. */}
      <div className="p-3.5">
        <h3 className="type-item-title flex gap-1.5">
          {collection.icon && (
            // On the cap-height center of the name's first line
            <CapAligned height={16}>
              <CollectionIcon
                icon={collection.icon}
                className="block h-4 w-4 text-fg-secondary"
              />
            </CapAligned>
          )}
          <span className="lines-2 min-w-0">{collection.name}</span>
        </h3>
        <p className="mt-1 lines-1 text-sm text-fg-secondary">
          {collection.description}
        </p>
        <div className="mt-2.5 flex h-5 items-center gap-2 font-mono text-micro text-fg-secondary">
          {footer && <span className="min-w-0 truncate">{footer}</span>}
          <span className="ml-auto shrink-0">
            {count} {count === 1 ? "edition" : "editions"}
          </span>
        </div>
      </div>
    </div>
  );
}
