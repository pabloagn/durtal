import { BackLink } from "@/components/shared/back-link";
import { DetailColumns } from "@/components/shared/detail-layout";
import { SkeletonBlock, SkeletonFacts, SkeletonLine, SkeletonTitleRow } from "@/components/shared/skeleton";

/**
 * A film while it loads, drawn in the film page's own layout: the way back,
 * the poster at the left edge, the title and the facts beside it
 * or, on a phone, below it. Each block sits where its content will (SLN-698).
 */
export default function FilmLoading() {
  return (
    <div role="status" aria-label="Loading the film">
      <div className="relative z-[1] mb-8">
        <BackLink href="/films">Back to films</BackLink>

        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="w-36 shrink-0 sm:w-44">
            <SkeletonBlock className="aspect-[2/3] w-full" />
          </div>

          <div className="min-w-0 flex-1">
            <SkeletonTitleRow />
            {/* Directed by, released, runtime, in the collection, your rating */}
            <SkeletonFacts rows={5} />
          </div>
        </div>
      </div>

      <DetailColumns record={<SkeletonBlock className="mb-8 h-64" />}>
        <div className="mb-8 max-w-2xl space-y-2">
          {[0, 1, 2, 3].map((line) => (
            <SkeletonLine key={line} className={`type-prose ${line === 3 ? "w-1/2" : "w-full"}`} />
          ))}
        </div>
      </DetailColumns>
    </div>
  );
}
