import { redirect } from "next/navigation";
import { FAVOURITES_PARAM, favouritesOnly } from "@/lib/constants/favourites";
import {
  parsePagination,
  lastPage,
  pageHref,
  type ListSearchParams,
} from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { Suspense } from "react";
import { FolderOpen } from "lucide-react";
import {
  getCollections,
  getCollectionCount,
  getCollectionCoverPreviews,
} from "@/lib/actions/collections";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NoResults } from "@/components/shared/no-results";
import { clearedListHref } from "@/lib/utils/list-params";
import { Spinner } from "@/components/ui/spinner";
import { EmptyIndex } from "@/components/shared/empty-index";
import { CreateCollectionDialog } from "./create-collection-dialog";
import { CollectionsView } from "@/components/collections/collections-view";
import { CollectionsFiltersBar } from "./collections-filters-bar";

export const metadata = { title: "Collections" };

/** The list's first read, started before the page knows whether any collection exists */
function collectionsQuery(params: ListSearchParams) {
  const { perPage, offset } = parsePagination(params);
  const favourites = favouritesOnly(params[FAVOURITES_PARAM]);
  const first = Promise.all([
    getCollections({
      limit: perPage,
      offset,
      query: typeof params.q === "string" ? params.q : undefined,
      favourites,
      sort: typeof params.sort === "string" ? params.sort : undefined,
      order: typeof params.order === "string" ? params.order : undefined,
    }),
    getCollectionCount(typeof params.q === "string" ? params.q : "", favourites),
  ]);
  // With none the list is never awaited: its failure must not go unhandled
  first.catch(() => {});
  return first;
}

async function CollectionsContent({
  params,
  list,
}: {
  params: ListSearchParams;
  list: ReturnType<typeof collectionsQuery>;
}) {
  const { page, perPage } = parsePagination(params);
  const favourites = favouritesOnly(params[FAVOURITES_PARAM]);
  const [collections, total] = await list;
  if (page > lastPage(total, perPage))
    redirect(pageHref("/collections", params, lastPage(total, perPage)));

  // Gone since the page checked, with no search or filter: none to show
  if (collections.length === 0 && !params.q && !favourites)
    return <EmptyState icon={FolderOpen} title="No collections yet" action={<CreateCollectionDialog />} />;
  // Nothing matched the search or filter: the way out is clearing it, as on
  // every list (SLN-845)
  if (collections.length === 0) {
    const query = new URLSearchParams(
      Object.entries(params).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
    );
    return (
      <NoResults
        noun="collections"
        search={typeof params.q === "string" ? params.q : null}
        hasFilters={favourites}
        clearHref={clearedListHref("/collections", query)}
      />
    );
  }

  const previews = await getCollectionCoverPreviews(
    collections.map((c) => c.id),
  );
  const paging = { page, perPage, total };

  return (
    <PaginatedSection {...paging} noun="collections">
      <CollectionsView
        collections={collections.map((collection) => ({
          // The counts and the line, not the members, go to the client (SLN-781)
          collection,
          covers: previews
            .filter((p) => p.collectionId === collection.id)
            .map((p) => p.s3Key),
        }))}
      />
    </PaginatedSection>
  );
}

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  // Whether any collection exists and the list itself, read side by side
  const any = getCollectionCount("", false);
  const params = await searchParams;
  const list = collectionsQuery(params);
  if (!(await any)) {
    return (
      <EmptyIndex
        title="Collections"
        icon={FolderOpen}
        empty="No collections yet"
        description="A collection gathers the works you choose: a shelf, a theme, a reading list. Make one, then add works to it."
        action={<CreateCollectionDialog />}
      />
    );
  }
  return (
    <>
      <PageHeader
        title="Collections"
        actions={<CreateCollectionDialog />}
      />
      <CollectionsFiltersBar />
      <Suspense
        key={JSON.stringify(params)}
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <CollectionsContent params={params} list={list} />
      </Suspense>
    </>
  );
}
