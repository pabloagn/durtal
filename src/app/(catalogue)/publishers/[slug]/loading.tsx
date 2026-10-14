import { BackLink } from "@/components/shared/back-link";
import { DetailColumns } from "@/components/shared/detail-layout";
import { SkeletonBlock, SkeletonLine } from "@/components/shared/skeleton";

/**
 * A publisher while it loads, drawn in the publisher page's own layout: the
 * way back, the logo's tile, the name and its facts, then the books. Each
 * block sits where its content will; a name that takes two lines moves what
 * is below it, which no loading screen can know (SLN-698).
 */
export default function PublisherLoading() {
  return (
    <div role="status" aria-label="Loading the publisher">
      <BackLink href="/publishers">Back to publishers</BackLink>

      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:gap-8">
        <SkeletonBlock className="size-40 shrink-0" />
        <div className="min-w-0 flex-1">
          <SkeletonLine className="type-page-title w-2/3" />
          <SkeletonBlock text className="mt-3 h-6 w-1/3" />
        </div>
      </div>

      <DetailColumns record={<SkeletonBlock className="mb-8 h-64" />}>
        <section className="mb-8">
          <SkeletonLine className="type-section-title mb-4 w-32" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonBlock key={i} className="aspect-[2/3]" />
            ))}
          </div>
        </section>
      </DetailColumns>
    </div>
  );
}
