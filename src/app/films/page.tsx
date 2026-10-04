import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { DOMAIN_ICONS } from "@/components/shortcuts/section-icons";
import { DomainSwitch } from "@/components/domains/domain-switch";
import {
  DomainAddLink,
  domainDescription,
} from "@/components/domains/domain-add-link";
import { FilmFilters } from "@/components/films/film-filters";
import { FilmGrid } from "@/components/films/film-grid";
import { getFilmCount, getFilmFilterOptions, getFilms } from "@/lib/actions/films";
import { filmQueryFromParams, hasFilmFilters } from "@/lib/catalogue/film-params";
import {
  lastPage,
  pageHref,
  parsePagination,
  type ListSearchParams,
} from "@/lib/utils/pagination";

export const metadata = { title: "Films" };

/** One page of the films the URL asks for: its search, filters, sort and page. */
async function FilmResults({ params }: { params: ListSearchParams }) {
  const query = filmQueryFromParams(params);
  const { page, perPage, offset } = parsePagination(params);
  // Count first: a page past the end goes to the last page before any read
  // with an offset beyond what the list accepts
  const total = await getFilmCount(query);
  if (total > 0 && page > lastPage(total, perPage))
    redirect(pageHref("/films", params, lastPage(total, perPage)));
  const films =
    offset < total ? await getFilms({ ...query, limit: perPage, offset }) : [];
  return (
    <FilmGrid
      films={films}
      pagination={{ page, perPage, total }}
      hasFilters={hasFilmFilters(params)}
    />
  );
}

/**
 * The film home: every film in the catalogue by its poster, with its
 * directors and facts; filters by director, cast, genre, language, country,
 * the copies held, favourites and release years.
 */
export default async function FilmsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const [catalogued, options] = await Promise.all([
    getFilmCount(),
    getFilmFilterOptions(),
  ]);

  return (
    <>
      <PageHeader
        title="Films"
        description={domainDescription("film")}
        actions={<DomainAddLink kind="film" />}
        tabs={<DomainSwitch current="film" searchParams={params} />}
      />
      {catalogued === 0 ? (
        <EmptyState
          icon={DOMAIN_ICONS.film}
          title="No films yet"
          description="Add your first film: who made it and who plays in it, then its versions and the copies you keep."
          action={<DomainAddLink kind="film" />}
        />
      ) : (
        <>
          <FilmFilters options={options} />
          <Suspense
            key={JSON.stringify(params)}
            fallback={
              <div className="py-16">
                <Spinner />
              </div>
            }
          >
            <FilmResults params={params} />
          </Suspense>
        </>
      )}
    </>
  );
}
