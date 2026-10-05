import Link from "next/link";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { Badge } from "@/components/ui/badge";
import { FadeImage } from "@/components/shared/fade-image";
import { ShelfSpines } from "@/components/shared/no-photo";
import { CardHeading } from "@/components/shared/card-heading";

export interface SeriesItem {
  id: string;
  title: string;
  originalTitle: string | null;
  bookCount: number;
  ownedCount: number;
  /** Volumes read at least once (SLN-449) */
  readCount?: number;
  totalVolumes: number | null;
  isComplete: boolean;
  isFavourite: boolean;
  covers: string[];
}

function imageUrl(key: string) {
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

function countsLabel(s: SeriesItem) {
  const books = `${s.bookCount} ${s.bookCount === 1 ? "book" : "books"}`;
  const of = s.totalVolumes ? ` of ${s.totalVolumes}` : "";
  return [`${books}${of}`, s.ownedCount ? `${s.ownedCount} owned` : null, s.readCount ? `${s.readCount} read` : null]
    .filter(Boolean)
    .join(" · ");
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
      <div className="relative aspect-[3/2] overflow-hidden rounded-t-sm bg-bg-tertiary">
        {s.covers.length ? (
          <div className="flex h-full">
            {s.covers.map((key) => (
              <FadeImage
                key={key}
                src={imageUrl(key)}
                alt=""
                loading="lazy"
                className="protected-image h-full min-w-0 flex-1 object-cover group-hover:scale-[1.02]"
              />
            ))}
          </div>
        ) : (
          // No book in the catalogue yet: one spine per known volume
          <ShelfSpines seed={s.id} volumes={s.totalVolumes ?? null} />
        )}
      </div>
      <div className="p-3.5">
        {/* Two title lines and one original-title line, always: every
            series card has the same height. The covers show no overlay. */}
        <CardHeading
          title={s.title}
          titleClassName="group-hover:text-accent-rose-text"
          subtitle={s.originalTitle !== s.title ? s.originalTitle : null}
          subtitleClassName="text-xs italic text-fg-secondary"
          action={
            <FavouriteToggle
              favourite={s.isFavourite}
              target={{ entity: "series", id: s.id }}
              name={s.title}
            />
          }
        />
        <div className="mt-2.5 flex h-5 items-center gap-2 font-mono text-micro text-fg-secondary">
          <span className="min-w-0 truncate">{countsLabel(s)}</span>
          {s.isComplete && (
            <span className="ml-auto shrink-0 text-accent-gold">Complete</span>
          )}
        </div>
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
      <FavouriteToggle
        favourite={s.isFavourite}
        target={{ entity: "series", id: s.id }}
        name={s.title}
        className="relative z-20"
      />
    </div>
  );
}
