import { Suspense } from "react";
import { SkeletonBlock } from "@/components/shared/skeleton";
import { NumberTiles } from "@/components/reading/stats-parts";
import { WrittenChart } from "./written-chart";
import { YearCovers } from "./covers";
import { n } from "@/lib/reading/charts";
import { compactYearCounts, percentOf } from "@/lib/statistics/charts";
import { libraryStatistics } from "@/lib/statistics/library";

/*
 * The body of the dashboard's Statistics section (SLN-742): four numbers the
 * dashboard does not show elsewhere, the year with the most books as its
 * covers, and when the books were written. The
 * dashboard draws the section around it (its rule, the "Statistics" heading
 * and View all, to /statistics). It loads in its own Suspense boundary, so
 * the rest of the dashboard never waits for it, and its reads start with the
 * dashboard's first ones (`statisticsReads`), not once the sections above it
 * are in (SLN-795).
 */

const CHART_HEIGHT = 140;

/** The section's reads, started at once: one statement, the busiest year's covers with the rest (SLN-1315) */
export function statisticsReads() {
  const reads = libraryStatistics(["numbers", "written", "breakdown", "busiest"], { busiest: 1 });
  // Read by the section once it draws; a dashboard that fails before that leaves no unhandled rejection
  reads.catch(() => {});
  return reads;
}

type StatisticsReads = ReturnType<typeof statisticsReads>;

async function Content({ reads }: { reads: StatisticsReads }) {
  const {
    numbers,
    written,
    breakdown: split,
    busiest: [busiest],
  } = await reads;
  if (numbers.books === 0) return <p className="text-sm text-fg-secondary">No books on your shelves yet.</p>;
  return (
    <div className="space-y-6" data-dashboard-statistics="">
      <NumberTiles
        tiles={[
          // No page count is not zero pages, as on /statistics (SLN-824)
          numbers.pages > 0 ? { label: "Pages on your shelves", value: n(numbers.pages) } : { label: "No page counts yet", value: "\u2014" },
          { label: "Languages", value: n(numbers.languages) },
          { label: "Authors' countries", value: n(numbers.countries) },
          { label: "Read", value: `${percentOf(split.read, split.read + split.unread)}%` },
        ]}
      />
      {busiest && <YearCovers year={busiest} caption="Most books from one year" />}
      {written.years.length > 0 && <WrittenChart years={compactYearCounts(written.years)} height={CHART_HEIGHT} />}
    </div>
  );
}

/** While it loads: the tiles and the chart's frame, as they will be */
function Pending() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading the statistics">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[6.25rem]" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <SkeletonBlock className="h-12 w-24" />
        <div className="grid max-w-[44rem] grid-cols-5 gap-2 sm:gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBlock key={i} className="aspect-[2/3]" />
          ))}
        </div>
      </div>
      <SkeletonBlock text className="mt-11" style={{ height: CHART_HEIGHT }} />
    </div>
  );
}

export function DashboardStatistics({ reads }: { reads: StatisticsReads }) {
  return (
    <Suspense fallback={<Pending />}>
      <Content reads={reads} />
    </Suspense>
  );
}
