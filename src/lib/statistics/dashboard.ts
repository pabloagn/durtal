import { breakdown, busiestYears, libraryNumbers, writtenYears } from "./library";

/** Load early, while the rest of the dashboard is still reading its shelves. */
export async function loadDashboardStatistics() {
  const numbersRead = libraryNumbers();
  const writtenRead = writtenYears();
  const splitRead = breakdown();
  // Only this query needs the years; it does not need the totals or split.
  const busiestRead = writtenRead.then((written) => busiestYears(written.years, 1));
  const [numbers, written, split, busiest] = await Promise.all([
    numbersRead, writtenRead, splitRead, busiestRead,
  ]);
  return { numbers, written, split, busiest: busiest[0] };
}

export type DashboardStatisticsData = Awaited<ReturnType<typeof loadDashboardStatistics>>;
