import Link from "next/link";
import type { ReactNode } from "react";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { FactsRow } from "@/components/shared/facts-row";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";

/**
 * A film, perfume or painting in a list: a small picture, the title, then
 * who made it and its facts, and what is held. Nothing is cut at any width:
 * the title wraps, the facts wrap between facts (`FactsRow`, so no line
 * starts with a separator), and the star sits on the title's first line.
 * From 640px what is held is set beside the title, on its baseline; under
 * 640px it goes under the facts.
 */
export function WorkRow({
  href,
  thumbnail,
  title,
  facts,
  held,
  favourite,
}: {
  href: string;
  /** The picture, sized by its own classes (`shrink-0` is added) */
  thumbnail: ReactNode;
  title: string;
  /** Who made it first, then the facts; empty ones are left out */
  facts: (string | null | undefined)[];
  held?: string | null;
  favourite: { on: boolean; workId: string };
}) {
  return (
    <div className="flex items-start gap-3 rounded-sm border border-transparent px-3 py-2 transition-colors hover:border-glass-border hover:bg-bg-secondary/60">
      <Link href={href} className="flex min-w-0 flex-1 items-start gap-3">
        {thumbnail}
        <div className="min-w-0 flex-1">
          <p className="type-item-title [overflow-wrap:anywhere]">{title}</p>
          <FactsRow facts={facts.filter((f): f is string => !!f)} />
          {held && <p className="text-xs text-fg-secondary sm:hidden">{held}</p>}
        </div>
        {held && (
          <span className="type-item-title hidden shrink-0 sm:block">
            <span className="font-sans text-xs text-fg-secondary">{held}</span>
          </span>
        )}
      </Link>
      <CapAlignedControls height={32} coarseHeight={44} className="type-item-title">
        <FavouriteToggle
          favourite={favourite.on}
          target={{ entity: "work", id: favourite.workId }}
          name={title}
        />
      </CapAlignedControls>
    </div>
  );
}
