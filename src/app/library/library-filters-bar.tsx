"use client";

import { usePreference } from "@/lib/hooks/use-preference";
import { LibraryFilters } from "./filters";
import type { ViewMode } from "@/components/books/view-mode-switcher";

const LIBRARY_VIEW_MODES: ViewMode[] = ["grid", "list", "detailed", "timeline"];

/**
 * Standalone filters bar that always renders, independent of book data.
 * Used outside the Suspense/data boundary so it's never hidden.
 */
export function LibraryFiltersBar() {
  const [viewMode, setViewMode] = usePreference<ViewMode>(
    "durtal-view-mode",
    "grid",
  );
  const [gridColumns, setGridColumns] = usePreference(
    "durtal-grid-columns",
    6,
  );

  return (
    <div className="mb-4">
      <LibraryFilters
        viewMode={viewMode}
        gridColumns={gridColumns}
        onViewModeChange={setViewMode}
        onGridColumnsChange={setGridColumns}
        availableViewModes={LIBRARY_VIEW_MODES}
      />
    </div>
  );
}
