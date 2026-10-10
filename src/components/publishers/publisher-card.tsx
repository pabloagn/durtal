import { parentPhrase } from "@/lib/publishers/kinds";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { CardHeading } from "@/components/shared/card-heading";
import { Monogram } from "@/components/shared/no-photo";

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
  /** The house's active logo */
  logoUrl?: string | null;
  /** The logo is a logo card (SLN-441): it fills its tile */
  logoIsCard?: boolean;
  createdAt: string;
}

/**
 * The house's logo, whole on a dark tile; with no logo, its initials on a
 * faint tint, like an author with no portrait (`Monogram`)
 */
export function PublisherLogo({
  name,
  url,
  card = false,
  className,
}: {
  name: string;
  url?: string | null;
  /** A logo card already holds its margins and black ground: it fills the tile */
  card?: boolean;
  className: string;
}) {
  return (
    <div className={`relative flex items-center justify-center overflow-hidden bg-bg-tertiary ${className}`}>
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className={`protected-image ${card ? "h-full w-full object-cover" : "max-h-[80%] max-w-[80%] object-contain"}`}
        />
      ) : (
        <Monogram name={name} />
      )}
    </div>
  );
}

function editionsLabel(count: number) {
  return `${count} ${count === 1 ? "edition" : "editions"}`;
}

/** Grid card: the house's logo, then its name, kind, country and count. */
export function PublisherCard({ publisher: p }: { publisher: PublisherItem }) {
  return (
    <div className="@container group relative flex flex-col rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link
        href={`/publishers/${p.slug}`}
        aria-label={`Open ${p.name}`}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <PublisherLogo name={p.name} url={p.logoUrl} card={p.logoIsCard} className="aspect-[3/2] rounded-t-sm border-b border-glass-border" />
      <div className="compact-card-section px-4 pt-4 pb-2">
        <CardHeading title={p.name} titleClassName="group-hover:text-accent-primary"
          action={<FavouriteToggle favourite={p.isFavourite} target={{ entity: "publisher", id: p.id }} name={p.name} />}
        />
      </div>
      {/* Metadata wraps without clipping at narrow widths */}
      <div className="compact-card-section flex min-h-5 min-w-0 flex-wrap items-center gap-1.5 px-4">
        {p.kind === "imprint" && <Badge variant="blue">Imprint</Badge>}
        {p.kind === "group" && <Badge variant="gold">Group</Badge>}
        {/* Beside the type badge a narrow card has no room for the country */}
        {p.country && (
          <span
            className={
              p.kind === "imprint" || p.kind === "group"
                ? "hidden @[160px]:contents"
                : "contents"
            }
          >
            <Badge variant="muted" className="min-w-0 whitespace-normal">
              <span className="[overflow-wrap:anywhere]">{p.country}</span>
            </Badge>
          </span>
        )}
      </div>
      <p className="compact-card-section mt-2 min-h-[1lh] [overflow-wrap:anywhere] px-4 text-xs text-fg-secondary">
        {p.parentName ? `Imprint of ${p.parentName}` : null}
      </p>
      <div className="compact-card-section mt-auto flex items-center justify-between gap-2 px-4 pb-3.5 pt-3">
        <span className="font-mono text-micro text-fg-secondary">
          {editionsLabel(p.editionCount)}
        </span>
        {/* A narrow card keeps the count on one line; the publisher page has the link */}
        {p.website && (
          <a
            href={p.website}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${p.name} website`}
            data-tooltip={`${p.name} website`}
            className="relative z-20 flex h-7 w-7 items-center justify-center text-fg-secondary transition-colors hover:text-accent-primary pointer-coarse:h-11 pointer-coarse:w-11"
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
        <PublisherLogo name={p.name} url={p.logoUrl} className="h-10 w-10 flex-shrink-0 rounded-sm [&_span]:text-xs" />
        <div className="min-w-0 flex-1">
          <h3 className="type-item-title truncate group-hover:text-accent-primary">
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
      <FavouriteToggle
        favourite={p.isFavourite}
        target={{ entity: "publisher", id: p.id }}
        name={p.name}
      />
    </div>
  );
}
