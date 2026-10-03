"use client";

import { useSearchParams } from "next/navigation";
import { usePreference } from "@/lib/hooks/use-preference";
import { EntityFilters } from "@/components/shared/entity-filters";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { LIST_PREFERENCES } from "@/lib/preferences";

/** Offered only while a search is active; it is then the default sort */
const RELEVANCE_SORT = { value: "relevance", label: "Best match" };

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "books", label: "Books" },
  { value: "recent", label: "Recent" },
];

export const RECOMMENDER_VIEW_MODES: ViewMode[] = LIST_PREFERENCES.recommenders.view.modes;

/**
 * Search, sort and view controls for /recommenders — the shared toolbar.
 * Rendered outside the results' Suspense boundary so it keeps focus.
 */
export function RecommendersFiltersBar() {
  const searchParams = useSearchParams();
  const isSearching = !!searchParams.get("q")?.trim();
  const [viewMode, setViewMode] = usePreference<ViewMode>(
    LIST_PREFERENCES.recommenders.view.key,
    LIST_PREFERENCES.recommenders.view.fallback,
  );
  const [gridColumns, setGridColumns] = usePreference(
    LIST_PREFERENCES.recommenders.grid.key,
    LIST_PREFERENCES.recommenders.grid.fallback,
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
