import { redirect } from "next/navigation";
import { collectionCountLine, collectionCounts } from "@/lib/collections/counts";
import { FavouritesFilter } from "@/components/shared/favourites-filter";
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
import { Spinner } from "@/components/ui/spinner";
import { EmptyIndex } from "@/components/shared/empty-index";
import { CreateCollectionDialog } from "./create-collection-dialog";
import { CollectionsView, CollectionsViewSwitcher } from "@/components/collections/collections-view";

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

  if (collections.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title={
          params.q || favourites ? "No matching collections" : "No collections yet"
        }
        description={
          params.q || favourites
            ? "Try another collection name or filter."
            : undefined
        }
        action={<CreateCollectionDialog />}
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
          collection: {
            ...collection,
            ...collectionCounts(collection),
            // The line, not every member, goes to the client (SLN-781)
            countLine: collectionCountLine(collection),
            collectionEditions: undefined,
            collectionWorks: undefined,
          },
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
      <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-3">
        <form className="flex min-w-48 max-w-md flex-1 gap-2" action="/collections">
          {/* A search keeps the favourites filter */}
          {favouritesOnly(params[FAVOURITES_PARAM]) && (
            <input type="hidden" name={FAVOURITES_PARAM} value="true" />
          )}
          <input
            name="q"
            defaultValue={typeof params.q === "string" ? params.q : ""}
            aria-label="Find collections"
            placeholder="Find collections…"
            className="h-8 min-w-0 flex-1 rounded-sm border border-glass-border bg-bg-primary px-3 text-sm pointer-coarse:h-11"
          />
          <button
            type="submit"
            className="rounded-sm border border-glass-border px-3 text-sm pointer-coarse:min-h-11"
          >
            Search
          </button>
        </form>
        <FavouritesFilter basePath="/collections" />
        {/* On a phone the views and card size take a row, as on Books (SLN-641) */}
        <div className="ml-auto pointer-coarse:max-md:basis-full">
          <CollectionsViewSwitcher />
        </div>
      </div>
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
