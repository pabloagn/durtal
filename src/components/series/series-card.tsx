import Link from "next/link";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { Badge } from "@/components/ui/badge";
import { FadeImage } from "@/components/shared/fade-image";
import { ShelfSpines } from "@/components/shared/no-photo";
import { CapAligned } from "@/components/shared/cap-aligned";
import { CardHeading } from "@/components/shared/card-heading";
import { mediaUrl } from "@/lib/s3/media-url";

export interface SeriesItem {
  id: string;
  title: string;
  originalTitle: string | null;
  bookCount: number;
  /** Volumes owned: accessioned with a copy (SLN-886) */
  ownedCount: number;
  /** Volumes read at least once (SLN-449) */
  readCount?: number;
  totalVolumes: number | null;
  isComplete: boolean;
  isFavourite: boolean;
  covers: string[];
  /** Its books' authors, most volumes first (SLN-636) */
  authors: string[];
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
    <div className="catalogue-card group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive">
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
                src={mediaUrl(key)}
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
      <div className="card-body">
        {/* Full titles remain readable; the shared body aligns the footer */}
        <CardHeading
          title={s.title}
          titleClassName="group-hover:text-accent-primary"
          subtitle={s.originalTitle && s.originalTitle !== s.title ? s.originalTitle : undefined}
          subtitleClassName="text-xs italic text-fg-secondary"
          action={
            <FavouriteToggle
              favourite={s.isFavourite}
              target={{ entity: "series", id: s.id }}
              name={s.title}
            />
          }
        />
        {s.authors.length > 0 && (
          <p className="mt-1 break-words text-xs text-fg-secondary">
            {s.authors.join(", ")}
          </p>
        )}
        <div className="mt-2.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-micro text-fg-secondary">
          <span className="min-w-0 [overflow-wrap:anywhere]">{countsLabel(s)}</span>
          {s.isComplete && (
            <span className="ml-auto shrink-0 text-accent-gold">Complete</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * List row, matching the other list pages. On a narrow page the counts go
 * under the names, so the title and authors keep their room.
 */
export function SeriesListItem({ series: s }: { series: SeriesItem }) {
  return (
    <div className="group relative flex items-start gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary">
      <Link
        href={`/series/${s.id}`}
        aria-label={`Open ${s.title}`}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="flex h-12 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary">
        {s.covers[0] ? (
          <img
            src={mediaUrl(s.covers[0])}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span data-decorative="" aria-hidden="true" className="font-serif text-xs text-fg-muted/40">
            {s.title[0]}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {/* The badge, counts and star sit on the title's first line */}
        <div className="flex items-start gap-3">
          <h3 className="type-item-title min-w-0 flex-1 [overflow-wrap:anywhere] group-hover:text-accent-primary">
            {s.title}
          </h3>
          <div className="type-item-title hidden h-[1lh] shrink-0 items-center gap-3 sm:flex">
            {s.isComplete && <Badge variant="gold">Complete</Badge>}
            <span className="w-40 text-right font-mono text-micro text-fg-secondary">
              {countsLabel(s)}
            </span>
          </div>
          <div className="type-item-title">
            <CapAligned height={32} coarseHeight={44} className="relative z-20">
              <FavouriteToggle
                favourite={s.isFavourite}
                target={{ entity: "series", id: s.id }}
                name={s.title}
              />
            </CapAligned>
          </div>
        </div>
        {s.originalTitle && s.originalTitle !== s.title && (
          <p className="text-xs italic text-fg-secondary [overflow-wrap:anywhere]">
            {s.originalTitle}
          </p>
        )}
        {s.authors.length > 0 && (
          <p className="text-xs text-fg-secondary [overflow-wrap:anywhere]">
            {s.authors.join(", ")}
          </p>
        )}
        <p className="truncate font-mono text-micro text-fg-secondary sm:hidden">
          {[countsLabel(s), s.isComplete ? "Complete" : null].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}
