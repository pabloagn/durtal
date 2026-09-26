import Link from "next/link";
import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { redirect } from "next/navigation";
import {
  parsePagination,
  lastPage,
  pageHref,
  type ListSearchParams,
} from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { Suspense } from "react";
import Image from "next/image";
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

function getImageUrl(s3Key: string) {
  return `/api/s3/read?key=${encodeURIComponent(s3Key)}`;
}

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
        {collections.map((collection) => {
          const editionCount = collection.collectionEditions?.length ?? 0;
          const posterKey =
            collection.posterThumbnailS3Key ??
            collection.posterS3Key ??
            collection.coverS3Key;
          const backgroundKey = collection.backgroundS3Key;
          const covers = previews.filter(
            (p) => p.collectionId === collection.id,
          );

          return (
            <div
              key={collection.id}
              className="group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive"
            >
              <Link
                href={`/collections/${collection.id}`}
                aria-label={`Open ${collection.name}`}
                className="absolute inset-0 z-10 rounded-sm focus-visible:outline focus-visible:outline-accent-rose"
              />
              {/* Poster image */}
              <div className="relative aspect-[2/3] overflow-hidden bg-bg-primary">
                {posterKey ? (
                  <Image
                    src={getImageUrl(posterKey)}
                    alt={collection.name}
                    fill
                    sizes="(min-width: 1280px) 220px, (min-width: 768px) 200px, 50vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    unoptimized
                  />
                ) : backgroundKey ? (
                  <Image
                    src={getImageUrl(backgroundKey)}
                    alt={collection.name}
                    fill
                    sizes="(min-width: 1280px) 220px, (min-width: 768px) 200px, 50vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    unoptimized
                  />
                ) : covers.length ? (
                  <div
                    className={`grid h-full ${covers.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
                  >
                    {covers.map((cover, index) => (
                      <img
                        key={index}
                        src={getImageUrl(cover.s3Key)}
                        alt=""
                        className={`h-full min-h-0 w-full object-cover ${covers.length === 3 && index === 2 ? "col-span-2" : ""}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2">
                    <FolderOpen
                      className="h-8 w-8 text-fg-muted/20"
                      strokeWidth={1}
                    />
                    <span className="font-serif text-sm text-fg-muted/30">
                      {collection.name[0]}
                    </span>
                  </div>
                )}

                <div className="absolute right-2 top-2 z-20 flex gap-1">
                  {posterKey && (
                    <ImageAdjustButton
                      source={getImageUrl(posterKey)}
                      label="Adjust collection poster"
                    />
                  )}
                  {backgroundKey && (
                    <ImageAdjustButton
                      source={getImageUrl(backgroundKey)}
                      label="Adjust collection background"
                    />
                  )}
                </div>
                {/* Gradient overlay at bottom */}
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-bg-primary/90 to-transparent" />

                {/* Edition count pill */}
                <div className="absolute bottom-2.5 right-2.5">
                  <span className="rounded-sm bg-bg-primary/70 px-2 py-0.5 font-mono text-micro text-fg-secondary backdrop-blur-sm">
                    {editionCount} {editionCount === 1 ? "edition" : "editions"}
                  </span>
                </div>
              </div>

              {/* Meta */}
              <div className="p-3.5">
                <h3 className="line-clamp-1 font-serif text-lg leading-snug text-fg-primary">
                  {collection.name}
                </h3>
                {collection.description && (
                  <p className="mt-1 line-clamp-2 text-micro leading-relaxed text-fg-muted">
                    {collection.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
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
