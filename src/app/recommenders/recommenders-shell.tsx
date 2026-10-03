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
  RecommenderCard,
  RecommenderListItem,
  type RecommenderItem,
} from "@/components/recommenders/recommender-card";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { RECOMMENDER_VIEW_MODES } from "./recommenders-filters-bar";

export function RecommendersShell({
  recommenders,
  pagination,
}: {
  recommenders: RecommenderItem[];
  pagination: PaginationData;
}) {
  const searchParams = useSearchParams();
  // Written by RecommendersFiltersBar; kept in sync through usePreference
  const [storedViewMode] = usePreference<ViewMode>(
    "durtal-recommenders-view-mode",
    "grid",
  );
  const viewMode = RECOMMENDER_VIEW_MODES.includes(storedViewMode)
    ? storedViewMode
    : "grid";
  const [gridColumns] = usePreference("durtal-recommenders-grid-columns", 4);

  if (pagination.total === 0) {
    return (
      <NoResults
        noun="recommenders"
        search={searchParams.get("q")}
        hasFilters={false}
        clearHref={clearedListHref("/recommenders", searchParams)}
      />
    );
  }
  if (recommenders.length === 0) {
    return (
      <PageOutOfRange
        firstPageHref={firstPageHref("/recommenders", searchParams)}
      />
    );
  }

  return (
    <>
      <Pagination {...pagination} noun="recommenders" compact />
      {viewMode === "grid" ? (
        <div className="@container">
          <div className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? COL_CLASSES[4]}`}>
            {recommenders.map((r) => (
              <RecommenderCard key={r.id} recommender={r} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {recommenders.map((r) => (
            <RecommenderListItem key={r.id} recommender={r} />
          ))}
        </div>
      )}
      <Pagination {...pagination} noun="recommenders" />
    </>
  );
}
