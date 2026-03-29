import { Suspense } from "react";
import { Tag } from "lucide-react";
import { getTags } from "@/lib/actions/taxonomy";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";

async function TagsContent() {
  const tags = await getTags();

  if (tags.length === 0) {
    return (
      <EmptyState
        icon={Tag}
        title="No tags yet"
        description="Tags can be added to editions for custom labelling"
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <Badge key={tag.id} variant="default" className="text-xs">
          {tag.color && (
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
          )}
          {tag.name}
        </Badge>
      ))}
    </div>
  );
}

export default function TagsPage() {
  return (
    <>
      <PageHeader title="Tags" description="Manage your edition labels" />
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <TagsContent />
      </Suspense>
    </>
  );
}
