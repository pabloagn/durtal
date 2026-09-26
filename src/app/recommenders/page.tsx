import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ThumbsUp } from "lucide-react";
import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { hasListQuery } from "@/lib/utils/list-params";
import { getRecommenderList } from "@/lib/actions/recommenders";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { RecommenderFormDialog } from "@/components/recommenders/recommender-form-dialog";
import { RecommendersFiltersBar } from "./recommenders-filters-bar";
import { RecommendersShell } from "./recommenders-shell";

interface SearchParams {
  q?: string;
  sort?: string;
  order?: string;
  page?: string;
  perPage?: string;
}

async function RecommendersContent({ params }: { params: SearchParams }) {
  const { page, perPage, offset } = parsePagination(params);
  const sort = ["relevance", "name", "books", "recent"].includes(
    params.sort ?? "",
  )
    ? (params.sort as "relevance" | "name" | "books" | "recent")
    : undefined;
  const order =
    params.order === "asc" || params.order === "desc"
      ? params.order
      : undefined;
  const { rows, total } = await getRecommenderList({
    search: params.q,
    sort,
    order,
    limit: perPage,
    offset,
  });
  if (page > lastPage(total, perPage))
    redirect(pageHref("/recommenders", params, lastPage(total, perPage)));

  const flat = new URLSearchParams(
    Object.entries(params).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  if (total === 0 && !hasListQuery(flat)) {
    return (
      <EmptyState
        icon={ThumbsUp}
        title="No recommenders yet"
        description="Add the people and channels whose recommendations you follow"
        action={<RecommenderFormDialog />}
      />
    );
  }

  return (
    <RecommendersShell
      recommenders={rows.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        bookCount: r.bookCount,
      }))}
      pagination={{ page, perPage, total }}
    />
  );
}

export default async function RecommendersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return (
    <>
      <PageHeader
        title="Recommenders"
        description="People and channels whose recommendations you follow"
        actions={<RecommenderFormDialog />}
      />
      <RecommendersFiltersBar />
      <Suspense
        key={JSON.stringify(params)}
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <RecommendersContent params={params} />
      </Suspense>
    </>
  );
}
