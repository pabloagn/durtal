import Link from "next/link";
import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface SeriesItem {
  id: string;
  title: string;
  originalTitle: string | null;
  bookCount: number;
  ownedCount: number;
  totalVolumes: number | null;
  isComplete: boolean;
  covers: string[];
}

function imageUrl(key: string) {
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

function countsLabel(s: SeriesItem) {
  const books = `${s.bookCount} ${s.bookCount === 1 ? "book" : "books"}`;
  const of = s.totalVolumes ? ` of ${s.totalVolumes}` : "";
  return s.ownedCount
    ? `${books}${of} · ${s.ownedCount} owned`
    : `${books}${of}`;
}

/** Grid card: the first books' covers side by side, like a shelf. */
export function SeriesCard({ series: s }: { series: SeriesItem }) {
  return (
    <div className="group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link
        href={`/series/${s.id}`}
        aria-label={`Open ${s.title}`}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="relative aspect-[3/2] overflow-hidden rounded-t-sm bg-bg-primary">
        {s.covers.length ? (
          <div className="flex h-full">
            {s.covers.map((key) => (
              <img
                key={key}
                src={imageUrl(key)}
                alt=""
                loading="lazy"
                className="protected-image h-full min-w-0 flex-1 object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <Layers className="h-8 w-8 text-fg-muted/20" strokeWidth={1} />
            <span className="font-serif text-sm text-fg-muted/30">
              {s.title[0]}
            </span>
          </div>
        )}
        {s.isComplete && (
          <div className="absolute right-2 top-2">
            <Badge variant="gold" className="backdrop-blur-md border-white/15">
              Complete
            </Badge>
          </div>
        )}
      </div>
      <div className="p-3.5">
        {/* Fixed lines: every series card has the same height */}
        <h3 className="type-item-title lines-2 group-hover:text-accent-rose-text">
          {s.title}
        </h3>
        <p className="mt-0.5 lines-1 text-xs italic text-fg-secondary">
          {s.originalTitle !== s.title ? s.originalTitle : null}
        </p>
        <p className="mt-2 font-mono text-micro text-fg-secondary">
          {countsLabel(s)}
        </p>
      </div>
    </div>
  );
}

/** List row, matching the other list pages. */
export function SeriesListItem({ series: s }: { series: SeriesItem }) {
  return (
    <div className="group relative flex items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary">
      <Link
        href={`/series/${s.id}`}
        aria-label={`Open ${s.title}`}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="flex h-12 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary">
        {s.covers[0] ? (
          <img
            src={imageUrl(s.covers[0])}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="font-serif text-xs text-fg-muted/40">
            {s.title[0]}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="type-item-title truncate group-hover:text-accent-rose-text">
          {s.title}
        </h3>
        {s.originalTitle && s.originalTitle !== s.title && (
          <p className="truncate text-xs italic text-fg-secondary">
            {s.originalTitle}
          </p>
        )}
      </div>
      {s.isComplete && <Badge variant="gold">Complete</Badge>}
      <span className="w-40 flex-shrink-0 text-right font-mono text-micro text-fg-secondary">
        {countsLabel(s)}
      </span>
    </div>
  );
}
