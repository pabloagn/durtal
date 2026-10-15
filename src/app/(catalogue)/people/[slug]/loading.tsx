import { BackLink } from "@/components/shared/back-link";
import { DetailColumns } from "@/components/shared/detail-layout";
import { SkeletonBlock, SkeletonLine, SkeletonTitleRow } from "@/components/shared/skeleton";

/**
 * A person while they load, drawn in the person page's own layout: the way
 * back, the portrait's box, the name with its star, Edit and menu, the line
 * of country and life dates, then their books. Before this, a click on a
 * person kept the last page with no sign until theirs arrived (task 0610).
 */
export default function PersonLoading() {
  return (
    <div role="status" aria-label="Loading the person">
      <BackLink href="/people">Back to people</BackLink>

      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:gap-8">
        <SkeletonBlock className="h-64 w-48 shrink-0" />
        <div className="min-w-0 flex-1">
          <SkeletonTitleRow row="wide" />
          {/* Country and life dates */}
          <SkeletonBlock text className="mt-3 h-5 w-48" />
        </div>
      </div>

      <DetailColumns record={<SkeletonBlock className="mb-8 h-64" />}>
        <section className="mb-8">
          <SkeletonLine className="type-section-title mb-4 w-32" />
          <div className="catalogue-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonBlock key={i} className="aspect-[2/3]" />
            ))}
          </div>
        </section>
      </DetailColumns>
    </div>
  );
}
