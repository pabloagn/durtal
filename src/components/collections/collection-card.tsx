import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";

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
  /** Optional extra line under the name, e.g. which edition is included */
  footer?: React.ReactNode;
}) {
  const poster = collectionPoster(collection.media);
  const count = collection.editionCount;
  return (
    <div className="group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link
        href={`/collections/${collection.id}`}
        aria-label={`Open ${collection.name}`}
        className="absolute inset-0 z-10 rounded-sm focus-visible:outline focus-visible:outline-accent-rose"
      />
      <div className="relative aspect-[2/3] overflow-hidden rounded-t-sm bg-bg-primary">
        {poster ? (
          <img
            src={imageUrl(poster.thumbnailS3Key ?? poster.s3Key)}
            alt={collection.name}
            loading="lazy"
            className="protected-image h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            style={mediaImageStyle(mediaCrop(poster))}
          />
        ) : covers.length ? (
          <div
            className={`grid h-full ${covers.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {covers.map((key, index) => (
              <img
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
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-bg-primary/90 to-transparent" />
        <div className="absolute bottom-2.5 right-2.5">
          <span className="rounded-sm bg-bg-primary/70 px-2 py-0.5 font-mono text-micro text-fg-secondary backdrop-blur-sm">
            {count} {count === 1 ? "edition" : "editions"}
          </span>
        </div>
      </div>

      <div className="p-3.5">
        <h3 className="line-clamp-1 font-serif text-lg leading-snug text-fg-primary">
          {collection.name}
        </h3>
        {collection.description && (
          <p className="mt-1 line-clamp-2 text-micro leading-relaxed text-fg-muted">
            {collection.description}
          </p>
        )}
        {footer}
      </div>
    </div>
  );
}
