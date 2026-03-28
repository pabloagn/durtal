export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { getCollections } from "@/lib/actions/collections";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";

async function CollectionsContent() {
  const collections = await getCollections();

  if (collections.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No collections yet"
        description="Create collections to organize your books into curated groups"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {collections.map((collection) => {
        const editionCount = collection.collectionEditions?.length ?? 0;
        return (
          <Card key={collection.id} hover>
            <CardContent className="py-4">
              <h3 className="font-serif text-base text-fg-primary">
                {collection.name}
              </h3>
              {collection.description && (
                <p className="mt-1 line-clamp-2 text-xs text-fg-secondary">
                  {collection.description}
                </p>
              )}
              <p className="mt-3 font-mono text-[10px] text-fg-muted">
                {editionCount} {editionCount === 1 ? "edition" : "editions"}
              </p>
            </CardContent>
          </Card>
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
