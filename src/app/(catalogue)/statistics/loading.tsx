import { PageHeader } from "@/components/layout/page-header";
import { SkeletonBlock, SkeletonLine } from "@/components/shared/skeleton";

/** The Statistics page while it counts: its header, the covers and the numbers, as they will be */
export default function StatisticsLoading() {
  return (
    <div role="status" aria-label="Loading the statistics">
      <PageHeader title="Statistics" description="The books on your shelves, in numbers." />
      <div className="space-y-14">
        <div className="flex justify-center">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBlock key={i} className="aspect-[2/3] w-[22%] max-w-36 shrink-0 [&+&]:-ml-[4%]" />
          ))}
        </div>
        <div>
          <SkeletonLine className="type-section-title mb-4 w-40" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <SkeletonBlock key={i} className="h-[6.25rem]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
