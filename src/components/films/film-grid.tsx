"use client";

import { useSearchParams } from "next/navigation";
import { Pagination, type PaginationData } from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { COL_CLASSES } from "@/components/shared/grid-columns";
import { useHomeView } from "@/components/domains/domain-home-shell";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { FilmCard, FilmRow, filmDirectors, filmHref, type FilmCardData } from "./film-card";
import { FilmPoster } from "./film-poster";
import { Mosaic, mosaicPerRow } from "@/components/shared/mosaic";
import { catalogueDateYears } from "@/lib/catalogue/dates";

/** The films of the home in the saved view (grid, mosaic or list), with paging. */
export function FilmGrid({
  films,
  pagination,
  hasFilters,
}: {
  films: FilmCardData[];
  pagination: PaginationData;
  hasFilters: boolean;
}) {
  const searchParams = useSearchParams();
  const { viewMode, gridColumns } = useHomeView("film");

  if (pagination.total === 0)
    return (
      <NoResults
        noun="films"
        search={searchParams.get("q")}
        hasFilters={hasFilters}
        clearHref={clearedListHref("/films", searchParams)}
      />
    );
  if (films.length === 0)
    return <PageOutOfRange firstPageHref={firstPageHref("/films", searchParams)} />;

  return (
    <>
      <Pagination {...pagination} noun="films" compact />
      {viewMode === "mosaic" ? (
        <Mosaic
          aspect={2 / 3}
          perRow={mosaicPerRow(gridColumns)}
          items={films.map((film) => ({
            key: film.id,
            href: filmHref(film),
            title: film.title,
            subtitle: filmDirectors(film),
            aspect: 2 / 3,
            media: <FilmPoster image={film.poster} title={film.title} year={catalogueDateYears(film.releaseDate)} />,
          }))}
        />
      ) : viewMode === "grid" ? (
        <div className="@container">
          <div className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? COL_CLASSES[4]}`}>
            {films.map((film) => (
              <FilmCard key={film.id} film={film} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {films.map((film) => (
            <FilmRow key={film.id} film={film} />
          ))}
        </div>
      )}
      <Pagination {...pagination} noun="films" />
    </>
  );
}
