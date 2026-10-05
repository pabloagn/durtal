import Link from "next/link";
import type { DomainTile } from "@/lib/catalogue/domain-homes";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { FadeImage } from "@/components/shared/fade-image";
import { Flacon, Monogram } from "@/components/shared/no-photo";
import { CardHeading } from "@/components/shared/card-heading";
import { WORK_CARD, WORK_CARD_BODY, WorkCardArt, WorkCardInfo } from "@/components/shared/work-card";

/**
 * The record's image in a list thumbnail, fading in over the frame's tone, or
 * the collection's stand-in: a flacon for a perfume, nothing for the others.
 */
function TileImage({ kind, tile }: { kind: WorkKind; tile: DomainTile }) {
  if (tile.imageUrl)
    return (
      <FadeImage
        src={tile.imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-contain"
      />
    );
  return kind === "perfume" ? <Flacon name={tile.title} initials={false} /> : null;
}

/** The people line when no one is credited, as on each collection's own card */
const NO_CREATORS: Record<WorkKind, string> = {
  book: "Unknown author",
  perfume: "Unknown house",
  film: "Director unknown",
  painting: "Painter unknown",
};

/**
 * A record of any collection in a grid, cut like a book's card (SLN-478), so
 * a row that mixes books, films, perfumes and paintings reads as one: the
 * picture whole in the cover's 2:3 frame, the title and the people on the
 * card heading's fixed lines, and the info row (status, rating, date).
 */
export function DomainTileCard({
  kind,
  tile,
}: {
  kind: WorkKind;
  tile: DomainTile;
}) {
  return (
    <div className={WORK_CARD}>
      <Link
        href={tile.href}
        aria-label={tile.title}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <WorkCardArt
        src={tile.imageUrl}
        tone={tile.tone}
        fallback={
          kind === "perfume" ? <Flacon name={tile.title} /> : <Monogram name={tile.title} />
        }
      />
      <div className={WORK_CARD_BODY}>
        <CardHeading title={tile.title} subtitle={tile.creators ?? NO_CREATORS[kind]} />
        <WorkCardInfo
          status={tile.status}
          copies={tile.copies}
          rating={tile.rating}
          year={tile.date}
        />
      </div>
    </div>
  );
}

/** A record of any collection in a list: small image, title, people, date. */
export function DomainTileRow({
  kind,
  tile,
}: {
  kind: WorkKind;
  tile: DomainTile;
}) {
  return (
    <Link
      href={tile.href}
      className="flex items-start gap-3 rounded-sm border border-transparent px-3 py-2 transition-colors hover:border-glass-border hover:bg-bg-secondary/60"
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
        <TileImage kind={kind} tile={tile} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="type-item-title truncate">{tile.title}</p>
        <p className="truncate text-sm text-fg-secondary">{tile.creators}</p>
      </div>
      <span className="shrink-0 font-mono text-micro leading-6 text-fg-secondary">
        {tile.date}
      </span>
    </Link>
  );
}
