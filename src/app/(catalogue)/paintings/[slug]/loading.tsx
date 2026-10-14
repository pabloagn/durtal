import { BackLink } from "@/components/shared/back-link";
import { DetailColumns } from "@/components/shared/detail-layout";
import { SkeletonBlock, SkeletonFacts, SkeletonLine, SkeletonTitleRow } from "@/components/shared/skeleton";
import { paintingRatio } from "@/lib/catalogue/painting-labels";

/**
 * A painting while it loads, drawn in the painting page's own layout: the way
 * back, the picture (in the shape a painting takes when its own is not known
 * yet), the title and the facts. Each block sits where its content will; only
 * a picture of another shape moves what is below it on a phone (SLN-698).
 */
export default function PaintingLoading() {
  const ratio = paintingRatio(null);
  return (
    <div role="status" aria-label="Loading the painting">
      <BackLink href="/paintings">Back to paintings</BackLink>

      <div className="mb-10 grid gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="min-w-0">
          <div
            className="mx-auto w-full lg:mx-0"
            style={{ maxWidth: `min(100%, calc(78vh * ${ratio.toFixed(4)}))` }}
          >
            <SkeletonBlock className="w-full" style={{ aspectRatio: ratio }} />
          </div>
        </div>

        <div className="min-w-0">
          <SkeletonTitleRow />
          {/* Painted by, date, original, in the collection, your rating */}
          <SkeletonFacts rows={5} />
        </div>
      </div>

      <DetailColumns record={<SkeletonBlock className="mb-8 h-64" />}>
        <div className="mb-10 max-w-2xl space-y-2">
          {[0, 1, 2, 3].map((line) => (
            <SkeletonLine key={line} className={`type-prose ${line === 3 ? "w-1/2" : "w-full"}`} />
          ))}
        </div>
      </DetailColumns>
    </div>
  );
}
