import Link from "next/link";
import { CapAligned } from "@/components/shared/cap-aligned";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { ExternalLink } from "lucide-react";
import { websiteLabel } from "@/lib/validations/recommenders";

export interface RecommenderItem {
  id: string;
  name: string;
  url: string | null;
  bookCount: number;
  isFavourite: boolean;
}

function booksLabel(count: number) {
  return `${count} ${count === 1 ? "book" : "books"}`;
}

function WebsiteLink({ url, name }: { url: string; name: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name} website`}
      className="relative z-20 inline-flex min-w-0 items-center gap-1 text-xs text-fg-secondary transition-colors hover:text-accent-rose-text"
    >
      <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.5} />
      <span className="truncate">{websiteLabel(url)}</span>
    </a>
  );
}

/** Grid card: recommenders have no artwork, so the card leads with the name. */
export function RecommenderCard({
  recommender: r,
}: {
  recommender: RecommenderItem;
}) {
  return (
    <div className="group relative flex flex-col rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link
        href={`/recommenders/${r.id}`}
        aria-label={`Open ${r.name}`}
        className="absolute inset-0 z-10 rounded-sm"
      />
      {/* Fixed rows: every recommender card has the same height */}
      {/* The row carries the name's type: the star sits on the cap-height
          center of the name's first line */}
      <div className="type-item-title flex items-start gap-2 p-4 pb-2">
        <h3 className="type-item-title lines-2 min-w-0 flex-1 group-hover:text-accent-rose-text">
          {r.name}
        </h3>
        <CapAligned height={32} coarseHeight={44} className="relative z-20 -mr-2 pointer-coarse:-mr-3.5">
          <FavouriteToggle
            favourite={r.isFavourite}
            target={{ entity: "recommender", id: r.id }}
            name={r.name}
          />
        </CapAligned>
      </div>
      <div className="flex h-4 min-w-0 items-center px-4">
        {r.url && <WebsiteLink url={r.url} name={r.name} />}
      </div>
      <p className="mt-auto px-4 pb-3.5 pt-3 font-mono text-micro text-fg-secondary">
        {booksLabel(r.bookCount)}
      </p>
    </div>
  );
}

/** List row, matching the author, place and publisher list rows. */
export function RecommenderListItem({
  recommender: r,
}: {
  recommender: RecommenderItem;
}) {
  return (
    <div className="group relative flex items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary">
      <Link
        href={`/recommenders/${r.id}`}
        aria-label={`Open ${r.name}`}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm bg-bg-tertiary">
        <span className="font-serif text-sm text-fg-muted/50">{r.name[0]}</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="type-item-title truncate group-hover:text-accent-rose-text">
          {r.name}
        </h3>
        {r.url && <WebsiteLink url={r.url} name={r.name} />}
      </div>
      <span className="w-20 flex-shrink-0 text-right font-mono text-micro text-fg-secondary">
        {booksLabel(r.bookCount)}
      </span>
      <FavouriteToggle
        favourite={r.isFavourite}
        target={{ entity: "recommender", id: r.id }}
        name={r.name}
        className="relative z-20"
      />
    </div>
  );
}
