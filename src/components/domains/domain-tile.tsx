import Link from "next/link";
import type { DomainTile } from "@/lib/catalogue/domain-homes";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { Flacon, Monogram } from "@/components/shared/no-photo";
import { CardHeading } from "@/components/shared/card-heading";
import { WORK_CARD, WORK_CARD_BODY, WorkCardArt, WorkCardInfo } from "@/components/shared/work-card";

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
 * card heading's fixed lines, and the info row (rating, date).
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
        <WorkCardInfo rating={tile.rating} year={tile.date} />
      </div>
    </div>
  );
}
