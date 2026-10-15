import { Suspense } from "react";
import { favouritesOnly } from "@/lib/constants/favourites";
import { redirect } from "next/navigation";
import { ThumbsUp } from "lucide-react";
import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { getRecommenderList, hasRecommenders } from "@/lib/actions/recommenders";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { RecommenderFormDialog } from "@/components/recommenders/recommender-form-dialog";
import { RecommendersFiltersBar } from "./recommenders-filters-bar";
import { RecommendersShell } from "./recommenders-shell";

export const metadata = { title: "Recommenders" };

interface SearchParams {
  q?: string;
  sort?: string;
  order?: string;
  page?: string;
  perPage?: string;
  favourites?: string;
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
    favourites: favouritesOnly(params.favourites) || undefined,
  });
  if (page > lastPage(total, perPage))
    redirect(pageHref("/recommenders", params, lastPage(total, perPage)));

  return (
    <RecommendersShell
      recommenders={rows.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        bookCount: r.bookCount,
        isFavourite: r.isFavourite,
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
  const [params, any] = await Promise.all([searchParams, hasRecommenders()]);
  // With none, no toolbar over nothing: one empty state with one Add (SLN-834)
  if (!any) {
    return (
      <>
        <PageHeader title="Recommenders" />
        <EmptyState
          icon={ThumbsUp}
          heading="h2"
          title="No recommenders yet"
          description="A recommender is whoever suggested a book to you: a friend, a critic, a podcast. Add one, then link them to the books they suggested."
          action={<RecommenderFormDialog />}
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Recommenders"
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
