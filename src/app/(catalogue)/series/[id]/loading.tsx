import { BackLink } from "@/components/shared/back-link";
import { DETAIL_TITLE_ROW } from "@/components/shared/detail-layout";
import { SkeletonBlock, SkeletonLine } from "@/components/shared/skeleton";

/**
 * A series while it loads, drawn in the page's own layout (SLN-751): the way
 * back, the title with its star and menu, its authors and counts, then its
 * books. A title, author line or description that takes more lines, or the
 * lines a series may add under its counts, move what is below them, which no
 * loading screen can know (SLN-698).
 */
export default function SeriesLoading() {
  return (
    <div role="status" aria-label="Loading the series">
      <BackLink href="/series">Back to series</BackLink>
      <header className="mb-8 min-w-0">
        {/* The title row with the star and menu (196px, 220px on touch), under
            the title in a narrow row, where nearly every title wraps them */}
        <div className="@container">
          <div data-title-length="short" className={`type-page-title flex flex-wrap items-start ${DETAIL_TITLE_ROW.free}`}>
            <SkeletonLine titleLength="short" className="type-page-title w-full min-w-0 @min-[30rem]:w-1/2" />
            <div className="type-page-title flex h-[1lh] shrink-0 items-center">
              <SkeletonBlock className="h-8 w-49 pointer-coarse:h-11 pointer-coarse:w-55" />
            </div>
          </div>
        </div>
        {/* Its authors, then its counts */}
        <SkeletonLine className="mt-2 w-48 text-sm" />
        <SkeletonBlock className="mt-3 h-6 w-48" />
      </header>
      <section className="mb-8">
        <SkeletonLine className="type-section-title mb-4 w-32" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonBlock key={i} className="aspect-[2/3]" />
          ))}
        </div>
      </section>
    </div>
  );
}
