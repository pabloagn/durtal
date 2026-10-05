import Link from "next/link";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { CardHeading } from "@/components/shared/card-heading";
import { WORK_CARD, WORK_CARD_BODY, WorkCardInfo } from "@/components/shared/work-card";
import { Disc3 } from "lucide-react";
import type { getFilms } from "@/lib/actions/films";
import { catalogueDateYears } from "@/lib/catalogue/dates";
import { filmHoldingsText, formatRuntime } from "@/lib/catalogue/film-labels";
import {
  COVER_CHIP,
  COVER_CHIP_ICON,
  COVER_CHIP_TEXT,
  COVER_CHIP_TONE,
  COVER_CORNER,
} from "@/components/books/cover-chip";
import { FilmPoster } from "./film-poster";

export type FilmCardData = Awaited<ReturnType<typeof getFilms>>[number];

export function filmHref(film: { id: string; slug: string | null }) {
  return `/films/${film.slug ?? film.id}`;
}

/** The directors, by name or as credited: who the film is by */
export function filmDirectors(film: FilmCardData) {
  const names = film.directors.flatMap((d) => (d.name ? [d.name] : []));
  return names.length ? names.join(", ") : null;
}

/** "1982 · 1h 49m · US": the release year, runtime and production countries */
export function filmFacts(film: FilmCardData) {
  return [
    catalogueDateYears(film.releaseDate),
    formatRuntime(film.runtimeSeconds),
    film.countries.map((c) => c.alpha2).join(", ") || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A film in a grid: its poster, then a book card's heading and info row
 * (SLN-478): title, directors, rating and release year, on fixed
 * lines. A chip marks the copies held.
 */
export function FilmCard({
  film,
}: {
  film: FilmCardData;
}) {
  const held = filmHoldingsText(film.holdings);
  const count = film.holdings.physical + film.holdings.digital;
  return (
    <div className={WORK_CARD}>
      <Link
        href={filmHref(film)}
        aria-label={film.title}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="relative cover-shadow">
        <FilmPoster
          image={film.poster}
          title={film.title}
          year={catalogueDateYears(film.releaseDate)}
        />
        {held && (
          <div className={`${COVER_CORNER.topRight} z-20` /* above the card's link, so its tooltip opens */}>
            <span
              role="img"
              aria-label={`In the collection: ${held}`}
              className={`${COVER_CHIP} ${COVER_CHIP_TEXT} gap-0.5 text-fg-primary`}
              data-tooltip={`In the collection: ${held}`}
            >
              <Disc3 className={`${COVER_CHIP_ICON} ${COVER_CHIP_TONE.sage}`} strokeWidth={1.5} />
              {count}
            </span>
          </div>
        )}
      </div>
      <div className={WORK_CARD_BODY}>
        {/* As on a book's card: two title lines and one line of directors,
            then the info row, so cards of every collection line up */}
        <CardHeading
          title={film.title}
          subtitle={filmDirectors(film) ?? "Director unknown"}
          action={
            <FavouriteToggle
              favourite={film.isFavourite}
              target={{ entity: "work", id: film.id }}
              name={film.title}
            />
          }
        />
        <WorkCardInfo
          rating={film.rating}
          year={catalogueDateYears(film.releaseDate)}
        />
      </div>
    </div>
  );
}

/**
 * A film in a list: a small poster, title, directors and facts, what is held.
 * On a narrow page what is held goes under the facts, so the names stay whole.
 */
export function FilmRow({ film }: { film: FilmCardData }) {
  const held = filmHoldingsText(film.holdings);
  return (
    <div className="flex items-center gap-3 rounded-sm border border-transparent px-3 py-2 transition-colors hover:border-glass-border hover:bg-bg-secondary/60">
      <Link href={filmHref(film)} className="flex min-w-0 flex-1 items-center gap-3">
        <FilmPoster
          image={film.poster}
          title={film.title}
          small
          className="w-8 shrink-0 rounded-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="type-item-title truncate">{film.title}</p>
          <p className="truncate text-sm text-fg-secondary">
            {[filmDirectors(film) ?? "Director unknown", filmFacts(film)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {held && <p className="truncate text-xs text-fg-secondary sm:hidden">{held}</p>}
        </div>
        {held && (
          <span className="hidden shrink-0 text-xs leading-6 text-fg-secondary sm:block">
            {held}
          </span>
        )}
      </Link>
      <FavouriteToggle
        favourite={film.isFavourite}
        target={{ entity: "work", id: film.id }}
        name={film.title}
      />
    </div>
  );
}
