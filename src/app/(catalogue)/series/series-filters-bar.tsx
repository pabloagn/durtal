"use client";

import { FavouritesFilter } from "@/components/shared/favourites-filter";
import { useSearchParams } from "next/navigation";
import { usePreference } from "@/lib/hooks/use-preference";
import { EntityFilters } from "@/components/shared/entity-filters";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { LIST_PREFERENCES } from "@/lib/preferences";

/** Offered only while a search is active; it is then the default sort */
const RELEVANCE_SORT = { value: "relevance", label: "Best match" };
const SORT_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "books", label: "Books" },
  { value: "recent", label: "Recent" },
];
export const SERIES_VIEW_MODES: ViewMode[] = LIST_PREFERENCES.series.view.modes;

/** Search, sort and view controls for /series — the shared toolbar. */
export function SeriesFiltersBar() {
  const searchParams = useSearchParams();
  const isSearching = !!searchParams.get("q")?.trim();
  const [viewMode, setViewMode] = usePreference<ViewMode>(
    LIST_PREFERENCES.series.view.key,
    LIST_PREFERENCES.series.view.fallback,
  );
  const [gridColumns, setGridColumns] = usePreference(
    LIST_PREFERENCES.series.grid.key,
    LIST_PREFERENCES.series.grid.fallback,
  );
  return (
    <EntityFilters
      basePath="/series"
      sortOptions={
        isSearching ? [RELEVANCE_SORT, ...SORT_OPTIONS] : SORT_OPTIONS
      }
      searchPlaceholder="Search series..."
      defaultSort={isSearching ? "relevance" : "title"}
      defaultSortOrders={{
        relevance: "desc",
        title: "asc",
        books: "desc",
        recent: "desc",
      }}
      viewMode={SERIES_VIEW_MODES.includes(viewMode) ? viewMode : "grid"}
      gridColumns={gridColumns}
      onViewModeChange={setViewMode}
      onGridColumnsChange={setGridColumns}
      availableViewModes={SERIES_VIEW_MODES}
    >
      <FavouritesFilter basePath="/series" />
    </EntityFilters>
  );
}
