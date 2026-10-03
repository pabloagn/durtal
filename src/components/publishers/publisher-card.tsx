import { parentPhrase } from "@/lib/publishers/kinds";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PublisherFavourite } from "./favourite-button";
import { CapAligned } from "@/components/shared/cap-aligned";

export interface PublisherItem {
  id: string;
  slug: string;
  name: string;
  kind: string;
  country: string | null;
  parentName: string | null;
  website: string | null;
  isFavourite: boolean;
  editionCount: number;
  createdAt: string;
}

function editionsLabel(count: number) {
  return `${count} ${count === 1 ? "edition" : "editions"}`;
}

/** Grid card: publishers have no artwork, so the card leads with the name. */
export function PublisherCard({ publisher: p }: { publisher: PublisherItem }) {
  return (
    <div className="group relative flex flex-col rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link
        href={`/publishers/${p.slug}`}
        aria-label={`Open ${p.name}`}
        className="absolute inset-0 z-10 rounded-sm"
      />
      {/* The row carries the name's type: the star sits on the cap-height
          center of the name's first line */}
      <div className="type-item-title flex items-start gap-2 p-4 pb-2">
        <h3 className="type-item-title lines-2 min-w-0 flex-1 group-hover:text-accent-rose-text">
          {p.name}
        </h3>
        <CapAligned height={32} className="relative z-20 -mr-2">
          <PublisherFavourite id={p.id} favourite={p.isFavourite} />
        </CapAligned>
      </div>
      {/* Fixed rows: every publisher card has the same height */}
      <div className="flex h-5 min-w-0 items-center gap-1.5 overflow-hidden px-4">
        {p.kind === "imprint" && <Badge variant="blue">Imprint</Badge>}
        {p.kind === "group" && <Badge variant="gold">Group</Badge>}
        {p.country && (
          <Badge variant="muted" className="min-w-0">
            <span className="truncate">{p.country}</span>
          </Badge>
        )}
      </div>
      <p className="mt-2 lines-1 px-4 text-xs text-fg-secondary">
        {p.parentName ? `Imprint of ${p.parentName}` : null}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 px-4 pb-3.5 pt-3">
        <span className="font-mono text-micro text-fg-secondary">
          {editionsLabel(p.editionCount)}
        </span>
        {p.website && (
          <a
            href={p.website}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${p.name} website`}
            data-tooltip={`${p.name} website`}
            className="relative z-20 text-fg-muted transition-colors hover:text-accent-rose"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
          </a>
        )}
      </div>
    </div>
  );
}

/** List row, matching the author and place list rows. */
export function PublisherListItem({
  publisher: p,
}: {
  publisher: PublisherItem;
}) {
  return (
    <div className="group relative flex items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary">
      <Link
        href={`/publishers/${p.slug}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm bg-bg-tertiary">
          <span className="font-serif text-sm text-fg-muted/50">
            {p.name[0]}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="type-item-title truncate group-hover:text-accent-rose-text">
            {p.name}
          </h3>
          <p className="truncate text-xs text-fg-secondary">
            {[p.country, parentPhrase(p.kind, p.parentName)]
              .filter(Boolean)
              .join(" · ") || " "}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          {p.kind === "imprint" && <Badge variant="blue">Imprint</Badge>}
          {p.kind === "group" && <Badge variant="gold">Group</Badge>}
          <span className="w-20 text-right font-mono text-micro text-fg-secondary">
            {editionsLabel(p.editionCount)}
          </span>
        </div>
      </Link>
      <PublisherFavourite id={p.id} favourite={p.isFavourite} />
    </div>
  );
}
