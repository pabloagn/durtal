import Link from "next/link";
import { CardHeading } from "@/components/shared/card-heading";
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
      className="relative z-20 inline-flex min-w-0 items-center gap-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-xs text-fg-secondary transition-colors hover:text-accent-primary"
    >
      <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.5} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{websiteLabel(url)}</span>
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
      <div className="compact-card-section px-4 pt-4 pb-2">
        <CardHeading title={r.name} titleClassName="group-hover:text-accent-primary"
          action={<FavouriteToggle favourite={r.isFavourite} target={{ entity: "recommender", id: r.id }} name={r.name} />}
        />
      </div>
      <div className="compact-card-section flex min-h-4 min-w-0 items-center px-4">
        {r.url && <WebsiteLink url={r.url} name={r.name} />}
      </div>
      <p className="compact-card-section mt-auto px-4 pb-3.5 pt-3 font-mono text-micro text-fg-secondary">
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
        <h3 className="type-item-title truncate group-hover:text-accent-primary">
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
