import { Suspense } from "react";
import { favouritesOnly } from "@/lib/constants/favourites";
import { redirect } from "next/navigation";
import { ThumbsUp } from "lucide-react";
import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { getRecommenderList, hasRecommenders } from "@/lib/actions/recommenders";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyIndex } from "@/components/shared/empty-index";
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

function listOptions(params: SearchParams) {
  const { perPage, offset } = parsePagination(params);
  const sort = ["relevance", "name", "books", "recent"].includes(
    params.sort ?? "",
  )
    ? (params.sort as "relevance" | "name" | "books" | "recent")
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

async function RecommendersContent({
  params,
  list,
}: {
  params: SearchParams;
  list: ReturnType<typeof getRecommenderList>;
}) {
  const { page, perPage } = parsePagination(params);
  const { rows, total } = await list;
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
  // Whether there is any recommender and the list itself, read side by side
  const any = hasRecommenders();
  const params = await searchParams;
  const list = getRecommenderList(listOptions(params));
  // With none the list is never awaited: its failure must not go unhandled
  list.catch(() => {});
  // With none, no toolbar over nothing: one empty state with one Add (SLN-834)
  if (!(await any)) {
    return (
      <EmptyIndex
        title="Recommenders"
        icon={ThumbsUp}
        empty="No recommenders yet"
        description="A recommender is whoever suggested a book to you: a friend, a critic, a podcast. Add one, then link them to the books they suggested."
        action={<RecommenderFormDialog />}
      />
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
        <RecommendersContent params={params} list={list} />
      </Suspense>
    </>
  );
}
