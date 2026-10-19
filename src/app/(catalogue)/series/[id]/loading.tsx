import { BackLink } from "@/components/shared/back-link";
import { DETAIL_TITLE_ROW, DetailControls } from "@/components/shared/detail-layout";
import { SkeletonBlock, SkeletonLine } from "@/components/shared/skeleton";

/**
 * A series while it loads, drawn in the page's own layout (SLN-751): the way
 * back, the title with its controls, its authors and counts, then its
 * books, one row each. A title, author line or description that takes more lines, or the
 * lines a series may add under its counts, move what is below them, which no
 * loading screen can know (SLN-698).
 */
export default function SeriesLoading() {
  return (
    <div role="status" aria-label="Loading the series">
      <BackLink href="/series">Back to series</BackLink>
      <header className="mb-8 min-w-0">
        {/* The title row with the star, Add books, Edit and menu (257px, 281px on
            touch): at the row's end beside the title, where the page's title
            pushes them, and under the title in a row under 688px, where a
            title of twenty letters already wraps them */}
        <div className="@container">
          <div data-title-length="short" className={`type-page-title flex flex-wrap items-start ${DETAIL_TITLE_ROW.free}`}>
            <SkeletonLine titleLength="short" className="type-page-title w-full min-w-0 @min-[43rem]:w-1/2" />
            <div className="shrink-0 @min-[43rem]:ml-auto">
              <DetailControls>
                <SkeletonBlock className="h-8 w-[261px] pointer-coarse:h-11 pointer-coarse:w-[285px]" />
              </DetailControls>
            </div>
          </div>
        </div>
        {/* Its authors, then its counts */}
        <SkeletonLine className="mt-2 w-48 text-sm" />
        <SkeletonBlock className="mt-3 h-6 w-48" />
      </header>
      <section className="mb-8">
        <SkeletonLine className="type-section-title mb-4 w-32" />
        {/* Its books in order, a row each as the page lists them: 86px, and on
            a phone with a one-line title, its author and the row's controls */}
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonBlock key={i} className="h-[86px] max-sm:h-[137px] max-sm:pointer-coarse:h-[153px]" />
          ))}
        </div>
      </section>
    </div>
  );
}
