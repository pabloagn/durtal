"use client";

import { useSearchParams } from "next/navigation";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { EntityFilters } from "@/components/shared/entity-filters";
import type { ViewMode } from "@/components/books/view-mode-switcher";

/** Offered only while a search is active; it is then the default sort */
const RELEVANCE_SORT = { value: "relevance", label: "Best match" };

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "books", label: "Books" },
  { value: "recent", label: "Recent" },
];

export const RECOMMENDER_VIEW_MODES: ViewMode[] = ["grid", "list"];

/**
 * Search, sort and view controls for /recommenders — the shared toolbar.
 * Rendered outside the results' Suspense boundary so it keeps focus.
 */
export function RecommendersFiltersBar() {
  const searchParams = useSearchParams();
  const isSearching = !!searchParams.get("q")?.trim();
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>(
    "durtal-recommenders-view-mode",
    "grid",
  );
  const [gridColumns, setGridColumns] = useLocalStorage(
    "durtal-recommenders-grid-columns",
    4,
  );
  return (
    <EntityFilters
      basePath="/recommenders"
      sortOptions={
        isSearching ? [RELEVANCE_SORT, ...SORT_OPTIONS] : SORT_OPTIONS
      }
      searchPlaceholder="Search recommenders..."
      defaultSort={isSearching ? "relevance" : "name"}
      defaultSortOrders={{
        relevance: "desc",
        name: "asc",
        books: "desc",
        recent: "desc",
      }}
      viewMode={RECOMMENDER_VIEW_MODES.includes(viewMode) ? viewMode : "grid"}
      gridColumns={gridColumns}
      onViewModeChange={setViewMode}
      onGridColumnsChange={setGridColumns}
      availableViewModes={RECOMMENDER_VIEW_MODES}
    />
  );
}
