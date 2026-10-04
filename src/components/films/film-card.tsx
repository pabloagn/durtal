import Link from "next/link";
import { CapAligned } from "@/components/shared/cap-aligned";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
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
 * A film in a grid: its poster, title, directors and facts, each on fixed
 * lines so every card of a grid has one height. Chips mark a favourite and
 * the copies held.
 */
export function FilmCard({
  film,
  caption,
}: {
  film: FilmCardData;
  /** Replaces the facts line: why the card is shown ("With Kurt Russell") */
  caption?: string;
}) {
  const held = filmHoldingsText(film.holdings);
  const count = film.holdings.physical + film.holdings.digital;
  return (
    <div className="@container group relative block rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link
        href={filmHref(film)}
        aria-label={film.title}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="relative shadow-[0_2px_16px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]">
        <FilmPoster
          image={film.poster}
          title={film.title}
          year={catalogueDateYears(film.releaseDate)}
        />
        {held && (
          {/* Above the card's link, so its tooltip opens */}
          <div className={`${COVER_CORNER.topRight} z-20`}>
            <span
              role="img"
              aria-label={`In the collection: ${held}`}
              className={`${COVER_CHIP} ${COVER_CHIP_TEXT} ${COVER_CHIP_TONE.sage} gap-0.5`}
              data-tooltip={`In the collection: ${held}`}
            >
              <Disc3 className={COVER_CHIP_ICON} strokeWidth={1.5} />
              {count}
            </span>
          </div>
        )}
      </div>
      <div className="p-3">
        {/* The row carries the title's type: the star sits on the
            cap-height center of the title's first line */}
        <div className="type-item-title flex items-start gap-2">
          <h3 className="type-item-title lines-2 min-w-0 flex-1">{film.title}</h3>
          <CapAligned height={32} className="relative z-20 -mr-2">
            <FavouriteToggle
              favourite={film.isFavourite}
              target={{ entity: "work", id: film.id }}
              name={film.title}
            />
          </CapAligned>
        </div>
        <p className="mt-1 lines-1 text-sm text-fg-secondary">
          {filmDirectors(film) ?? "Director unknown"}
        </p>
        <p className="mt-1.5 lines-1 font-mono text-micro text-fg-secondary">
          {caption ?? filmFacts(film)}
        </p>
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
