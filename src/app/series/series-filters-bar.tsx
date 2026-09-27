"use client";

import { useSearchParams } from "next/navigation";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { EntityFilters } from "@/components/shared/entity-filters";
import type { ViewMode } from "@/components/books/view-mode-switcher";

/** Offered only while a search is active; it is then the default sort */
const RELEVANCE_SORT = { value: "relevance", label: "Best match" };
const SORT_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "books", label: "Books" },
  { value: "recent", label: "Recent" },
];
export const SERIES_VIEW_MODES: ViewMode[] = ["grid", "list"];

/** Search, sort and view controls for /series — the shared toolbar. */
export function SeriesFiltersBar() {
  const searchParams = useSearchParams();
  const isSearching = !!searchParams.get("q")?.trim();
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>(
    "durtal-series-view-mode",
    "grid",
  );
  const [gridColumns, setGridColumns] = useLocalStorage(
    "durtal-series-grid-columns",
    4,
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
    />
  );
}
