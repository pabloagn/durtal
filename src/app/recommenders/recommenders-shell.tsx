"use client";

import { useSearchParams } from "next/navigation";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import {
  Pagination,
  type PaginationData,
} from "@/components/shared/pagination";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import {
  RecommenderCard,
  RecommenderListItem,
  type RecommenderItem,
} from "@/components/recommenders/recommender-card";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { RECOMMENDER_VIEW_MODES } from "./recommenders-filters-bar";

const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

export function RecommendersShell({
  recommenders,
  pagination,
}: {
  recommenders: RecommenderItem[];
  pagination: PaginationData;
}) {
  const searchParams = useSearchParams();
  // Written by RecommendersFiltersBar; kept in sync through useLocalStorage events
  const [storedViewMode] = useLocalStorage<ViewMode>(
    "durtal-recommenders-view-mode",
    "grid",
  );
  const viewMode = RECOMMENDER_VIEW_MODES.includes(storedViewMode)
    ? storedViewMode
    : "grid";
  const [gridColumns] = useLocalStorage("durtal-recommenders-grid-columns", 4);

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
        <div
          className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? "grid-cols-4"}`}
        >
          {recommenders.map((r) => (
            <RecommenderCard key={r.id} recommender={r} />
          ))}
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
