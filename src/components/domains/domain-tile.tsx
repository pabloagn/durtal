import Image from "next/image";
import Link from "next/link";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { DomainTile } from "@/lib/catalogue/domain-homes";
import type { WorkKind } from "@/lib/catalogue/kinds";

/** Image slots per collection; images are contained, never cropped. */
const SLOT_CLASSES = {
  portrait: "aspect-[2/3]",
  square: "aspect-square",
  native: "aspect-[4/5]",
} as const;

/** The record's image, or the first letter of its title, as book cards show. */
function TileImage({
  tile,
  sizes,
  letterClass,
}: {
  tile: DomainTile;
  sizes: string;
  letterClass: string;
}) {
  return tile.imageUrl ? (
    <Image
      src={tile.imageUrl}
      alt=""
      fill
      sizes={sizes}
      className="object-contain"
      unoptimized
    />
  ) : (
    <div className="flex h-full items-center justify-center">
      <span className={`font-serif text-fg-muted/30 ${letterClass}`}>
        {tile.title.trim()[0]?.toUpperCase()}
      </span>
    </div>
  );
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
        className={`relative overflow-hidden bg-bg-primary ${SLOT_CLASSES[WORK_DOMAINS[kind].image.slot]}`}
      >
        <TileImage
          tile={tile}
          sizes="(min-width: 1280px) 220px, (min-width: 768px) 180px, 45vw"
          letterClass="text-3xl"
        />
      </div>
      <div className="p-3">
        {/* Fixed lines: every tile of a grid has the same height */}
        <h3 className="lines-2 font-serif text-base leading-snug text-fg-primary">
          {tile.title}
        </h3>
        <p className="mt-1 lines-1 text-sm text-fg-secondary">{tile.creators}</p>
        <p className="mt-1.5 lines-1 font-mono text-micro text-fg-secondary">
          {tile.date}
        </p>
      </div>
    </Link>
  );
}

/** A record of any collection in a list: small image, title, people, date. */
export function DomainTileRow({ tile }: { tile: DomainTile }) {
  return (
    <Link
      href={tile.href}
      className="flex items-start gap-3 rounded-sm border border-transparent px-3 py-2 transition-colors hover:border-glass-border hover:bg-bg-secondary/60"
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-bg-primary">
        <TileImage tile={tile} sizes="48px" letterClass="text-lg" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif text-base leading-snug text-fg-primary">
          {tile.title}
        </p>
        <p className="truncate text-sm text-fg-secondary">{tile.creators}</p>
      </div>
      <span className="shrink-0 font-mono text-micro leading-6 text-fg-secondary">
        {tile.date}
      </span>
    </Link>
  );
}
