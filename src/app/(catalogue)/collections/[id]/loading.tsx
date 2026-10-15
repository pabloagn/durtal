import { BackLink } from "@/components/shared/back-link";
import { SkeletonBlock, SkeletonLine } from "@/components/shared/skeleton";

/**
 * A collection while it loads, drawn in the page's own layout (SLN-751): the
 * way back, the poster's 192 by 256 box, the name, its counts and its four
 * controls,
 * then its members. A collection with a backdrop draws its header over it,
 * and a name or description that takes more lines moves what is below them,
 * which no loading screen can know (SLN-698).
 */
export default function CollectionLoading() {
  return (
    <div role="status" aria-label="Loading the collection">
      <div className="mb-8">
        <BackLink href="/collections">Back to collections</BackLink>
        <header className="mb-6 flex flex-wrap items-start gap-8">
          <SkeletonBlock className="h-64 w-48 shrink-0" />
          <div className="min-w-0 flex-1 basis-64">
            <SkeletonLine titleLength="short" className="type-page-title w-2/3" />
            <SkeletonLine className="my-4 w-40 text-xs" />
            {/* Add, Edit, Artwork and Delete, at their widths: they wrap where the page's do */}
            <div className="flex flex-wrap items-center gap-2">
              {["w-[69px]", "w-[72px]", "w-[99px]", "w-10 pointer-coarse:w-11"].map((width) => (
                <SkeletonBlock key={width} className={`h-8 pointer-coarse:h-11 ${width}`} />
              ))}
            </div>
          </div>
        </header>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBlock key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
