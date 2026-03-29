import { getCollections } from "@/lib/actions/collections";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FolderOpen } from "lucide-react";

export default async function CollectionsPage() {
  const collections = await getCollections();

  return (
    <>
      <PageHeader
        title="Collections"
        description="Your curated book collections"
      />
      {collections.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No collections yet"
          description="Create your first collection from any book's action menu"
        />
      ) : (
        <div className="grid gap-4 grid-cols-3">
          {collections.map((c) => (
            <div
              key={c.id}
              className="rounded-sm border border-glass-border bg-bg-secondary p-4"
            >
              <h3 className="font-serif text-lg text-fg-primary">{c.name}</h3>
              {c.description && (
                <p className="mt-1 text-sm text-fg-secondary line-clamp-2">
                  {c.description}
                </p>
              )}
              <p className="mt-2 font-mono text-xs text-fg-muted">
                {c.collectionEditions.length}{" "}
                {c.collectionEditions.length === 1 ? "edition" : "editions"}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
