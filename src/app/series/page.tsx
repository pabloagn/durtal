import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Layers, Sparkles } from "lucide-react";
import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { hasListQuery } from "@/lib/utils/list-params";
import { getSeriesList, getSeriesSuggestions } from "@/lib/actions/series";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
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
}

async function SeriesContent({ params }: { params: SearchParams }) {
  const { page, perPage, offset } = parsePagination(params);
  const sort = ["relevance", "title", "books", "recent"].includes(
    params.sort ?? "",
  )
    ? (params.sort as "relevance" | "title" | "books" | "recent")
    : undefined;
  const order =
    params.order === "asc" || params.order === "desc"
      ? params.order
      : undefined;
  const { rows, total } = await getSeriesList({
    search: params.q,
    sort,
    order,
    limit: perPage,
    offset,
  });
  if (page > lastPage(total, perPage))
    redirect(pageHref("/series", params, lastPage(total, perPage)));
  const flat = new URLSearchParams(
    Object.entries(params).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  if (total === 0 && !hasListQuery(flat))
    return (
      <EmptyState
        icon={Layers}
        title="No series yet"
        description="Group books that belong together, in reading order"
        action={<SeriesFormDialog />}
      />
    );
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
  const params = await searchParams;
  return (
    <>
      <PageHeader
        title="Series"
        description="Books that belong together, in reading order"
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
        <SeriesContent params={params} />
      </Suspense>
    </>
  );
}
