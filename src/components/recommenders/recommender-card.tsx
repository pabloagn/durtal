import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { websiteLabel } from "@/lib/validations/recommenders";

export interface RecommenderItem {
  id: string;
  name: string;
  url: string | null;
  bookCount: number;
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
      className="relative z-20 inline-flex min-w-0 items-center gap-1 text-xs text-fg-muted transition-colors hover:text-accent-rose"
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
        className="absolute inset-0 z-10 rounded-sm focus-visible:outline focus-visible:outline-accent-rose"
      />
      <h3 className="line-clamp-2 p-4 pb-2 font-serif text-xl leading-snug text-fg-primary group-hover:text-accent-rose">
        {r.name}
      </h3>
      {r.url && (
        <div className="flex min-w-0 px-4">
          <WebsiteLink url={r.url} name={r.name} />
        </div>
      )}
      <p className="mt-auto px-4 pb-3.5 pt-3 font-mono text-micro text-fg-muted">
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
        <h3 className="truncate font-serif text-lg text-fg-primary group-hover:text-accent-rose">
          {r.name}
        </h3>
        {r.url && <WebsiteLink url={r.url} name={r.name} />}
      </div>
      <span className="w-20 flex-shrink-0 text-right font-mono text-micro text-fg-muted">
        {booksLabel(r.bookCount)}
      </span>
    </div>
  );
}
