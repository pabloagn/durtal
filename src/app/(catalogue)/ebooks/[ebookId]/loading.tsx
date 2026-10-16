import Link from "next/link";
import { DetailColumns } from "@/components/shared/detail-layout";
import { SkeletonBlock, SkeletonLine } from "@/components/shared/skeleton";

/**
 * An eBook while it loads, drawn in the eBook page's own layout: the way back
 * to eBooks, the title with the line under it and Read, then the cover and
 * its author. Before this, a click on an eBook kept the last page with no
 * sign until its own arrived (task 0610).
 */
export default function EbookLoading() {
  return (
    <div role="status" aria-label="Loading the eBook">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-2 text-xs text-fg-secondary">
        <Link href="/ebooks" className="touch-hit text-command">
          eBooks
        </Link>
      </div>
      {/* The page header: the title with Read on its edge, as a short title
          has it at every width, and the line under it (SLN-877) */}
      <div className="mb-8">
        <div data-title-length="short" className="type-page-title flex items-start gap-x-4">
          {/* Sized as a short title: under 375px that is one step down */}
          <SkeletonLine titleLength="short" className="type-page-title w-1/2 min-w-0 sm:w-2/3" />
          {/* Read, the label of a book not yet begun */}
          <div className="type-page-title flex h-[1lh] shrink-0 items-center">
            <SkeletonBlock className="h-8 w-15 pointer-coarse:h-11" />
          </div>
        </div>
        <SkeletonLine className="mt-2 w-1/2 text-sm leading-relaxed" />
      </div>

      <DetailColumns record={<SkeletonBlock className="mb-8 h-64" />}>
        <div className="mb-8 flex flex-wrap items-start gap-6">
          <SkeletonBlock className="aspect-[2/3] w-52 max-w-full shrink-0" />
          <div className="min-w-0 flex-1 basis-48">
            <SkeletonLine className="type-item-title w-40" />
          </div>
        </div>
      </DetailColumns>
    </div>
  );
}
