import { Suspense } from "react";
import { favouritesOnly } from "@/lib/constants/favourites";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Layers, Sparkles } from "lucide-react";
import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { getSeriesList, getSeriesSuggestions, hasSeries } from "@/lib/actions/series";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyIndex } from "@/components/shared/empty-index";
import { Spinner } from "@/components/ui/spinner";
import { buttonClass } from "@/components/ui/button";
import { SeriesFormDialog } from "@/components/series/series-form-dialog";
import { SeriesFiltersBar } from "./series-filters-bar";
import { SeriesShell } from "./series-shell";

export const metadata = { title: "Series" };

interface SearchParams {
  q?: string;
  sort?: string;
  order?: string;
  page?: string;
  perPage?: string;
  favourites?: string;
}

function listOptions(params: SearchParams) {
  const { perPage, offset } = parsePagination(params);
  const sort = ["relevance", "title", "books", "recent"].includes(
    params.sort ?? "",
  )
    ? (params.sort as "relevance" | "title" | "books" | "recent")
    : undefined;
  const order =
    params.order === "asc" || params.order === "desc"
      ? (params.order as "asc" | "desc")
      : undefined;
  return {
    search: params.q,
    sort,
    order,
    limit: perPage,
    offset,
    favourites: favouritesOnly(params.favourites) || undefined,
  };
}

async function SeriesContent({
  params,
  list,
}: {
  params: SearchParams;
  list: ReturnType<typeof getSeriesList>;
}) {
  const { page, perPage } = parsePagination(params);
  const { rows, total } = await list;
  if (page > lastPage(total, perPage))
    redirect(pageHref("/series", params, lastPage(total, perPage)));
  return <SeriesShell series={rows} pagination={{ page, perPage, total }} />;
}

/** Link to the review page when some books match a series by title. */
async function SuggestionsLink() {
  const suggestions = await getSeriesSuggestions();
  if (!suggestions.length) return null;
  const seriesCount = new Set(suggestions.map((s) => s.seriesId)).size;
  return (
    <Link href="/series/suggestions" className={buttonClass("ghost", "sm")}>
      <Sparkles className="h-4 w-4" strokeWidth={1.5} />
      {suggestions.length} suggested{" "}
      {suggestions.length === 1 ? "book" : "books"} in {seriesCount}{" "}
      {seriesCount === 1 ? "series" : "series"}
    </Link>
  );
}

export default async function SeriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Whether there is any series and the list itself, read side by side
  const any = hasSeries();
  const params = await searchParams;
  const list = getSeriesList(listOptions(params));
  // With none the list is never awaited: its failure must not go unhandled
  list.catch(() => {});
  // With none, no toolbar over nothing: one empty state with one Add
  if (!(await any)) {
    return (
      <EmptyIndex
        title="Series"
        icon={Layers}
        empty="No series yet"
        description="A series is a run of books that belong together in order, such as a trilogy. Add one, then add its books by their place in it."
        action={<SeriesFormDialog />}
      />
    );
  }
  return (
    <>
      <PageHeader
        title="Series"
        actions={
          <div className="flex items-center gap-2">
            <Suspense fallback={null}>
              <SuggestionsLink />
            </Suspense>
            <SeriesFormDialog />
          </div>
        }
      />
      <SeriesFiltersBar />
      <Suspense
        key={JSON.stringify(params)}
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <SeriesContent params={params} list={list} />
      </Suspense>
    </>
  );
}
