import { BackLink } from "@/components/shared/back-link";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { SkeletonBlock, SkeletonLine } from "@/components/shared/skeleton";

/**
 * A recommender while they load, drawn in the page's own layout (SLN-817): the
 * way back, the name with its star and menu, the line of counts, then their
 * books. Before this, a click on a recommender kept the last page with no sign
 * until theirs arrived. A name that takes more lines, or a website on the line
 * of counts, moves what is below them, which no loading screen can know
 * (SLN-698).
 */
export default function RecommenderLoading() {
  return (
    <div role="status" aria-label="Loading the recommender">
      <BackLink href="/recommenders">Back to recommenders</BackLink>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <SkeletonLine className="type-page-title w-48 max-w-full sm:w-64" />
          {/* "12 books recommended", and how many of them are read */}
          <SkeletonLine className="mt-3 w-48 text-xs" />
        </div>
        {/* The star and menu, on the cap-height center of the name's line */}
        <CapAlignedControls height={32} coarseHeight={44} className="type-page-title">
          <SkeletonBlock className="h-8 w-[72px] pointer-coarse:h-11 pointer-coarse:w-24" />
        </CapAlignedControls>
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
