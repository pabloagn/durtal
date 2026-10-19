import { BackLink } from "@/components/shared/back-link";
import { DETAIL_TITLE_ROW, DetailControls } from "@/components/shared/detail-layout";
import { SkeletonBlock, SkeletonLine } from "@/components/shared/skeleton";

/**
 * A recommender while they load, drawn in the page's own layout (SLN-817): the
 * way back, the name with its star and menu, the line of counts, then their
 * books under the line that counts them. Before this, a click on a
 * recommender kept the last page with no sign until theirs arrived. A name
 * that takes more lines, or counts that wrap, move what is below them, which
 * no loading screen can know (SLN-698).
 */
export default function RecommenderLoading() {
  return (
    <div role="status" aria-label="Loading the recommender">
      <BackLink href="/recommenders">Back to recommenders</BackLink>
      <header className="mb-8 min-w-0">
        {/* The name with the star, Edit and menu (133px, 157px on touch) at the
            row's end, as the page draws them */}
        <div className="@container">
          {/* A person's name fits beside them from about 480px, so on a phone they sit under it */}
          <div data-title-length="short" className={`type-page-title flex flex-wrap items-start ${DETAIL_TITLE_ROW.free}`}>
            <SkeletonLine titleLength="short" className="type-page-title w-full min-w-0 @min-[30rem]:w-1/2" />
            <div className="shrink-0 @min-[30rem]:ml-auto">
              <DetailControls>
                <SkeletonBlock className="h-8 w-[133px] pointer-coarse:h-11 pointer-coarse:w-[157px]" />
              </DetailControls>
            </div>
          </div>
        </div>
        {/* Their website and "12 books recommended" */}
        <SkeletonBlock text className="mt-3 h-6 w-48" />
      </header>
      <section className="mb-8">
        <SkeletonLine className="type-section-title mb-4 w-32" />
        {/* "Showing 1–12 of 12 books" */}
        <SkeletonBlock text className="my-4 h-5 w-48" />
        {/* The page's own compact grid, so the columns match at every width */}
        <div className="@container">
          <div className="catalogue-grid catalogue-density-compact">
            {Array.from({ length: 8 }, (_, i) => (
              <SkeletonBlock key={i} className="aspect-[2/3]" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
