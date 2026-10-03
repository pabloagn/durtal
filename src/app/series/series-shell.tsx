"use client";

import { useSearchParams } from "next/navigation";
import { usePreference } from "@/lib/hooks/use-preference";
import {
  Pagination,
  type PaginationData,
} from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { COL_CLASSES } from "@/components/shared/grid-columns";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import {
  SeriesCard,
  SeriesListItem,
  type SeriesItem,
} from "@/components/series/series-card";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { SERIES_VIEW_MODES } from "./series-filters-bar";
import { LIST_PREFERENCES } from "@/lib/preferences";

export function SeriesShell({
  series,
  pagination,
}: {
  series: SeriesItem[];
  pagination: PaginationData;
}) {
  const searchParams = useSearchParams();
  const [storedViewMode] = usePreference<ViewMode>(
    LIST_PREFERENCES.series.view.key,
    LIST_PREFERENCES.series.view.fallback,
  );
  const viewMode = SERIES_VIEW_MODES.includes(storedViewMode)
    ? storedViewMode
    : "grid";
  const [gridColumns] = usePreference(
    LIST_PREFERENCES.series.grid.key,
    LIST_PREFERENCES.series.grid.fallback,
  );

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
        <div className="@container">
          <div className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? COL_CLASSES[4]}`}>
            {series.map((s) => (
              <SeriesCard key={s.id} series={s} />
            ))}
          </div>
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
