import Link from "next/link";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { DomainTile } from "@/lib/catalogue/domain-homes";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { FadeImage } from "@/components/shared/fade-image";
import { Flacon, Monogram } from "@/components/shared/no-photo";

/** Image slots per collection; images are contained, never cropped. */
const SLOT_CLASSES = {
  portrait: "aspect-[2/3]",
  square: "aspect-square",
  native: "aspect-[4/5]",
} as const;

/**
 * The record's image, fading in over the frame's tone, or the collection's
 * stand-in: a flacon for a perfume, the title's initials for the others.
 */
function TileImage({
  kind,
  tile,
  small = false,
}: {
  kind: WorkKind;
  tile: DomainTile;
  /** A list thumbnail: the stand-in carries no lettering */
  small?: boolean;
}) {
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
  if (kind === "perfume") return <Flacon name={tile.title} initials={!small} />;
  return small ? null : <Monogram name={tile.title} />;
}

/** A record of any collection in a grid: image, title, credited people, date. */
export function DomainTileCard({
  kind,
  tile,
}: {
  kind: WorkKind;
  tile: DomainTile;
}) {
  return (
    <Link
      href={tile.href}
      className="group rounded-sm border border-glass-border bg-bg-secondary card-interactive"
    >
      <div
        className={`relative overflow-hidden bg-bg-tertiary ${SLOT_CLASSES[WORK_DOMAINS[kind].image.slot]}`}
      >
        <TileImage kind={kind} tile={tile} />
      </div>
      <div className="p-3">
        {/* Fixed lines: every tile of a grid has the same height */}
        <h3 className="type-item-title lines-2">{tile.title}</h3>
        <p className="mt-1 lines-1 text-sm text-fg-secondary">{tile.creators}</p>
        <p className="mt-1.5 lines-1 font-mono text-micro text-fg-secondary">
          {tile.date}
        </p>
      </div>
    </Link>
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
        <TileImage kind={kind} tile={tile} small />
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
