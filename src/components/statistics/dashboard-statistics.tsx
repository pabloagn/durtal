import { Suspense } from "react";
import { SkeletonBlock } from "@/components/shared/skeleton";
import { NumberTiles } from "@/components/reading/stats-parts";
import { WrittenChart } from "./written-chart";
import { YearCovers } from "./covers";
import { n } from "@/lib/reading/charts";
import { percentOf } from "@/lib/statistics/charts";
import type { DashboardStatisticsData } from "@/lib/statistics/dashboard";

/*
 * The body of the dashboard's Statistics section (SLN-742): four numbers the
 * dashboard does not show elsewhere, the year with the most books as its
 * covers, and when the books were written. The
 * dashboard draws the section around it (its rule, the "Statistics" heading
 * and View all, to /statistics). Its data starts with the dashboard's other
 * reads and resolves in this Suspense boundary without delaying its shelves.
 */

const CHART_HEIGHT = 140;

async function Content({ data }: { data: Promise<DashboardStatisticsData> }) {
  const { numbers, written, split, busiest } = await data;
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
      {written.years.length > 0 && <WrittenChart years={written.years} height={CHART_HEIGHT} />}
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

export function DashboardStatistics({ data }: { data: Promise<DashboardStatisticsData> }) {
  return (
    <Suspense fallback={<Pending />}>
      <Content data={data} />
    </Suspense>
  );
}
