import Link from "next/link";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { collectionCountLine } from "@/lib/collections/counts";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";
import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import { CardHeading } from "@/components/shared/card-heading";
import { CountParts } from "./count-parts";
import { FadeImage } from "@/components/shared/fade-image";
import { CoverCells } from "@/components/shared/cover-cells";
import { mediaUrl } from "@/lib/s3/media-url";

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
  isFavourite?: boolean;
  /** Whole works shown (films, perfumes, paintings, books with no edition chosen) */
  workCount?: number;
  /** What it holds, for the count line */
  collectionEditions?: { edition?: { workId: string } | null }[];
  collectionWorks?: { workId: string; work?: { kind: WorkKind } | null }[];
  /** The count line worked out on the server, so a list sends its members' lines, not the members */
  countLine?: string | null;
  media?: ArtworkRow[];
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
  icon,
  footer,
}: {
  collection: CollectionCardData;
  /**
   * The collection's icon, drawn on the server (`collectionCardIcon`): the
   * icon set stays out of a client page's bundle, as /collections' view is
   */
  icon?: React.ReactNode;
  /** Member cover keys (first four), used only without a poster */
  covers?: string[];
  /** Short text in the info row, e.g. which of the book's editions it holds */
  footer?: React.ReactNode;
}) {
  const poster = collectionPoster(collection.media);
  // No artwork, nothing in it, or artwork that fails: the name's letter, as every blank cover
  const blank = (
    <div className={`h-full ${COVER_BLANK}`}>
      <CoverLetter title={collection.name} />
    </div>
  );
  const count = collection.countLine ?? collectionCountLine(collection) ?? "Empty";
  return (
    <div className="catalogue-card group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link
        href={`/collections/${collection.id}`}
        aria-label={`Open ${collection.name}`}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="relative aspect-[2/3] overflow-hidden rounded-t-sm bg-bg-tertiary">
        {poster ? (
          <FadeImage
            src={mediaUrl(poster.thumbnailS3Key ?? poster.s3Key)}
            alt={collection.name}
            loading="lazy"
            className="protected-image h-full w-full object-cover group-hover:scale-[1.02]"
            style={mediaImageStyle(mediaCrop(poster))}
            fallback={blank}
          />
        ) : covers.length ? (
          <CoverCells
            srcs={covers.map((key) => mediaUrl(key))}
            className={`grid h-full ${covers.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
            cellClassNames={covers.map(
              (_, index) => `h-full min-h-0 w-full object-cover ${covers.length === 3 && index === 2 ? "col-span-2" : ""}`,
            )}
            fallback={blank}
          />
        ) : (
          blank
        )}

        {/* Like the other cards' controls: shown on hover and keyboard focus */}
        {poster && (
          <div className="absolute right-2 top-2 z-20 hover-reveal-glass">
            <ImageAdjustButton
              source={mediaUrl(poster.s3Key)}
              label="Adjust collection poster"
              className="touch-hit"
            />
          </div>
        )}
      </div>

      {/* Names wrap in full; descriptive prose is a preview, with the full text on the collection page */}
      <div className="card-body">
        <CardHeading
          title={collection.name}
          icon={icon || undefined}
          // No description, no line: two blank lines read as a gap under the name
          subtitle={collection.description || undefined}
          subtitleLines={2}
          subtitleClassName="lines-2 text-sm text-fg-secondary"
          action={
            collection.isFavourite === undefined ? undefined : (
              <FavouriteToggle
                favourite={collection.isFavourite}
                target={{ entity: "collection", id: collection.id }}
                name={collection.name}
              />
            )
          }
        />
        <div className="mt-2.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-micro text-fg-secondary">
          {footer && <span className="min-w-0 [overflow-wrap:anywhere]">{footer}</span>}
          {/* A line of several kinds wraps between them, inside the card */}
          <span className="ml-auto min-w-0 text-right">
            <CountParts line={count} />
          </span>
        </div>
      </div>
    </div>
  );
}
