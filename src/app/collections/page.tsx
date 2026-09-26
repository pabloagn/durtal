import { redirect } from "next/navigation";
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
import { CreateCollectionDialog } from "./create-collection-dialog";
import { CollectionCard } from "@/components/collections/collection-card";

async function CollectionsContent({ params }: { params: ListSearchParams }) {
  const { page, perPage, offset } = parsePagination(params);
  const [collections, total] = await Promise.all([
    getCollections({
      limit: perPage,
      offset,
      query: typeof params.q === "string" ? params.q : undefined,
    }),
    getCollectionCount(typeof params.q === "string" ? params.q : ""),
  ]);
  if (page > lastPage(total, perPage))
    redirect(pageHref("/collections", params, lastPage(total, perPage)));

  if (collections.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title={params.q ? "No matching collections" : "No collections yet"}
        description={
          params.q
            ? "Try another collection name."
            : "Create collections to organize your books into curated groups"
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
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {collections.map((collection) => (
          <CollectionCard
            key={collection.id}
            collection={{
              ...collection,
              editionCount: collection.collectionEditions?.length ?? 0,
            }}
            covers={previews
              .filter((p) => p.collectionId === collection.id)
              .map((p) => p.s3Key)}
          />
        ))}
      </div>
    </PaginatedSection>
  );
}

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  return (
    <>
      <PageHeader
        title="Collections"
        description="Curated groups of books"
        actions={<CreateCollectionDialog />}
      />
      <form className="mb-5 flex max-w-md gap-2" action="/collections">
        <input
          name="q"
          defaultValue={typeof params.q === "string" ? params.q : ""}
          aria-label="Find collections"
          placeholder="Find collections…"
          className="h-8 min-w-0 flex-1 rounded-sm border border-glass-border bg-bg-primary px-3 text-sm"
        />
        <button
          type="submit"
          className="rounded-sm border border-glass-border px-3 text-sm"
        >
          Search
        </button>
      </form>
      <Suspense
        key={JSON.stringify(params)}
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <CollectionsContent params={params} />
      </Suspense>
    </>
  );
}
