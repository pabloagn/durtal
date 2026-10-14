import { BackLink } from "@/components/shared/back-link";
import { DetailColumns } from "@/components/shared/detail-layout";
import { SkeletonBlock, SkeletonLine, SkeletonTitleRow } from "@/components/shared/skeleton";
import { WORK_POSTER_BOX } from "./work-poster-box";

/**
 * A book while it loads, drawn in the book page's own layout: the way back,
 * the cover's box, the title and the lines under it, then the reading column
 * and the record. Each block sits where its content will (SLN-697).
 */
export default function BookLoading() {
  return (
    <div role="status" aria-label="Loading the book">
      <div className="relative z-[1] mb-8">
        <BackLink href="/library">Back to books</BackLink>

        <div className="mb-8 flex flex-col gap-6 sm:flex-row">
          <SkeletonBlock className={WORK_POSTER_BOX} />

          <div className="min-w-0 flex-1">
            <SkeletonTitleRow wide />
            {/* Author */}
            <SkeletonBlock text className="mt-2 h-6 w-40" />
            {/* Year, rating and marks */}
            <SkeletonBlock className="mt-2 h-7 w-48" />
            {/* Start reading */}
            <SkeletonBlock className="mt-3 h-8 w-36 pointer-coarse:h-11" />
            {/* Language and status */}
            <div className="mt-3 flex gap-1.5">
              <SkeletonBlock className="h-6 w-16" />
              <SkeletonBlock className="h-6 w-16" />
            </div>
          </div>
        </div>
      </div>

      <DetailColumns
        record={<SkeletonBlock className="mb-8 h-64" />}
      >
        <div className="mb-8 max-w-2xl space-y-2">
          {[0, 1, 2, 3].map((line) => (
            <SkeletonLine key={line} className={`type-prose ${line === 3 ? "w-1/2" : "w-full"}`} />
          ))}
        </div>
      </DetailColumns>
    </div>
  );
}
