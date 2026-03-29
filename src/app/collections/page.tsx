import { Suspense } from "react";
import Image from "next/image";
import { FolderOpen } from "lucide-react";
import { getCollections } from "@/lib/actions/collections";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { CreateCollectionDialog } from "./create-collection-dialog";

function getImageUrl(s3Key: string) {
  return `/api/s3/read?key=${encodeURIComponent(s3Key)}`;
}

async function CollectionsContent() {
  const collections = await getCollections();

  if (collections.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No collections yet"
        description="Create collections to organize your books into curated groups"
        action={<CreateCollectionDialog />}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {collections.map((collection) => {
        const editionCount = collection.collectionEditions?.length ?? 0;
        const posterKey =
          collection.posterThumbnailS3Key ?? collection.posterS3Key;
        const backgroundKey = collection.backgroundS3Key;

        return (
          <div
            key={collection.id}
            className="group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive"
          >
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
  );
}

export default function CollectionsPage() {
  return (
    <>
      <PageHeader
        title="Collections"
        description="Curated groups of books"
        actions={<CreateCollectionDialog />}
      />
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <CollectionsContent />
      </Suspense>
    </>
  );
}
