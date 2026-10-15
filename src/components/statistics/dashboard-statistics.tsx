import { Suspense } from "react";
import { SkeletonBlock } from "@/components/shared/skeleton";
import { NumberTiles } from "@/components/reading/stats-parts";
import { WrittenChart } from "./written-chart";
import { n } from "@/lib/reading/charts";
import { percentOf } from "@/lib/statistics/charts";
import { breakdown, libraryNumbers, writtenYears } from "@/lib/statistics/library";

/*
 * The body of the dashboard's Statistics section (SLN-742): four numbers the
 * dashboard does not show elsewhere and when the books were written. The
 * dashboard draws the section around it (its rule, the "Statistics" heading
 * and View all, to /statistics). Self-contained: it loads in its own
 * Suspense boundary, so the rest of the dashboard never waits for it.
 */

const CHART_HEIGHT = 140;

async function Content() {
  const [numbers, written, split] = await Promise.all([libraryNumbers(), writtenYears(), breakdown()]);
  if (numbers.books === 0) return <p className="text-sm text-fg-secondary">No books on your shelves yet.</p>;
  return (
    <div className="space-y-6" data-dashboard-statistics="">
      <NumberTiles
        tiles={[
          { label: "Pages on your shelves", value: n(numbers.pages) },
          { label: "Languages", value: n(numbers.languages) },
          { label: "Authors' countries", value: n(numbers.countries) },
          { label: "Read", value: `${percentOf(split.read, split.read + split.unread)}%` },
        ]}
      />
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
      <SkeletonBlock text className="mt-11" style={{ height: CHART_HEIGHT }} />
    </div>
  );
}

export function DashboardStatistics() {
  return (
    <Suspense fallback={<Pending />}>
      <Content />
    </Suspense>
  );
}
