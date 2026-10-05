import Link from "next/link";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { CardHeading } from "@/components/shared/card-heading";
import { WORK_CARD, WORK_CARD_BODY, WorkCardInfo } from "@/components/shared/work-card";
import { Frame } from "lucide-react";
import type { getPaintings } from "@/lib/actions/paintings";
import { catalogueDateYears } from "@/lib/catalogue/dates";
import { ownerText } from "@/lib/catalogue/painting-labels";
import {
  COVER_CHIP,
  COVER_CHIP_ICON,
  COVER_CHIP_TEXT,
  COVER_CHIP_TONE,
  COVER_CORNER,
} from "@/components/books/cover-chip";
import { PaintingImage } from "./painting-image";

export type PaintingCardData = Awaited<ReturnType<typeof getPaintings>>[number];

export function paintingHref(painting: { id: string; slug: string | null }) {
  return `/paintings/${painting.slug ?? painting.id}`;
}

/** The painters, by name or as credited: who the painting is by */
export function paintingPainters(painting: PaintingCardData) {
  const names = painting.painters.flatMap((p) => (p.name ? [p.name] : []));
  return names.length ? names.join(", ") : null;
}

/** Who owns the original, when an institution or a private collection does */
function originalOwner(painting: PaintingCardData) {
  const object = painting.primaryObject;
  if (!object || (object.ownership !== "institutional" && object.ownership !== "private"))
    return null;
  return ownerText({
    ownership: object.ownership,
    ownerName: object.owner,
    ownerLabel: object.owner,
  });
}

/** "1889 · Museum of Modern Art": the date and who owns the original */
export function paintingFacts(painting: PaintingCardData) {
  return [catalogueDateYears(painting.creationDate), originalOwner(painting)]
    .filter(Boolean)
    .join(" · ");
}

function ownedText(count: number) {
  return count === 1 ? "1 object" : `${count} objects`;
}

/** The size of the primary object, for the proportions of a stand-in */
function objectSize(painting: PaintingCardData) {
  const object = painting.primaryObject;
  return object ? { widthCm: object.widthCm, heightCm: object.heightCm } : null;
}

/**
 * A painting in a gallery: the whole picture in a fixed frame, then a book
 * card's heading and info row (SLN-478): title, painters, rating and date,
 * on fixed lines. A chip marks the objects you own of it.
 */
export function PaintingCard({
  painting,
}: {
  painting: PaintingCardData;
}) {
  const owned = painting.personalCount;
  return (
    <div className={WORK_CARD}>
      <Link
        href={paintingHref(painting)}
        aria-label={painting.title}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="relative cover-shadow">
        <PaintingImage
          image={painting.poster}
          title={painting.title}
          year={catalogueDateYears(painting.creationDate)}
          size={objectSize(painting)}
        />
        {owned > 0 && (
          <div className={`${COVER_CORNER.topRight} z-20` /* above the card's link, so its tooltip opens */}>
            <span
              role="img"
              aria-label={`In the collection: ${ownedText(owned)}`}
              className={`${COVER_CHIP} ${COVER_CHIP_TEXT} gap-0.5 text-fg-primary`}
              data-tooltip={`In the collection: ${ownedText(owned)}`}
            >
              <Frame className={`${COVER_CHIP_ICON} ${COVER_CHIP_TONE.sage}`} strokeWidth={1.5} />
              {owned}
            </span>
          </div>
        )}
      </div>
      <div className={WORK_CARD_BODY}>
        {/* As on a book's card: two title lines and one line of painters,
            then the info row, so cards of every collection line up */}
        <CardHeading
          title={painting.title}
          subtitle={paintingPainters(painting) ?? "Painter unknown"}
          action={
            <FavouriteToggle
              favourite={painting.isFavourite}
              target={{ entity: "work", id: painting.id }}
              name={painting.title}
            />
          }
        />
        <WorkCardInfo
          rating={painting.rating}
          year={catalogueDateYears(painting.creationDate)}
        />
      </div>
    </div>
  );
}

/**
 * A painting in a list: a small picture, title, painters and facts, the
 * objects owned. On a narrow page the objects go under the facts, so the
 * names stay whole.
 */
export function PaintingRow({ painting }: { painting: PaintingCardData }) {
  const owned = painting.personalCount ? ownedText(painting.personalCount) : null;
  return (
    <div className="flex items-center gap-3 rounded-sm border border-transparent px-3 py-2 transition-colors hover:border-glass-border hover:bg-bg-secondary/60">
      <Link href={paintingHref(painting)} className="flex min-w-0 flex-1 items-center gap-3">
        <PaintingImage
          image={painting.poster}
          title={painting.title}
          size={objectSize(painting)}
          small
          className="w-10 shrink-0 rounded-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="type-item-title truncate">{painting.title}</p>
          <p className="truncate text-sm text-fg-secondary">
            {[paintingPainters(painting) ?? "Painter unknown", paintingFacts(painting)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {owned && <p className="truncate text-xs text-fg-secondary sm:hidden">{owned}</p>}
        </div>
        {owned && (
          <span className="hidden shrink-0 text-xs leading-6 text-fg-secondary sm:block">
            {owned}
          </span>
        )}
      </Link>
      <FavouriteToggle
        favourite={painting.isFavourite}
        target={{ entity: "work", id: painting.id }}
        name={painting.title}
      />
    </div>
  );
}
