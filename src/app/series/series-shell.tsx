"use client";

import { useSearchParams } from "next/navigation";
import { usePreference } from "@/lib/hooks/use-preference";
import {
  Pagination,
  type PaginationData,
} from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import {
  SeriesCard,
  SeriesListItem,
  type SeriesItem,
} from "@/components/series/series-card";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { SERIES_VIEW_MODES } from "./series-filters-bar";

const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

export function SeriesShell({
  series,
  pagination,
}: {
  series: SeriesItem[];
  pagination: PaginationData;
}) {
  const searchParams = useSearchParams();
  const [storedViewMode] = usePreference<ViewMode>(
    "durtal-series-view-mode",
    "grid",
  );
  const viewMode = SERIES_VIEW_MODES.includes(storedViewMode)
    ? storedViewMode
    : "grid";
  const [gridColumns] = usePreference("durtal-series-grid-columns", 4);

  if (pagination.total === 0)
    return (
      <NoResults
        noun="series"
        search={searchParams.get("q")}
        hasFilters={false}
        clearHref={clearedListHref("/series", searchParams)}
      />
    );
  if (series.length === 0)
    return (
      <PageOutOfRange firstPageHref={firstPageHref("/series", searchParams)} />
    );

  return (
    <>
      <Pagination {...pagination} noun="series" compact />
      {viewMode === "grid" ? (
        <div
          className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? "grid-cols-4"}`}
        >
          {series.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {series.map((s) => (
            <SeriesListItem key={s.id} series={s} />
          ))}
        </div>
      )}
      <Pagination {...pagination} noun="series" />
    </>
  );
}
