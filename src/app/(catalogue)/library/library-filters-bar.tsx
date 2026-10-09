"use client";

import {
  usePreference,
  useViewModePreference,
} from "@/lib/hooks/use-preference";
import { LibraryFilters } from "./filters";
import { LIBRARY_VIEW_MODES } from "./view-modes";
import { LIST_PREFERENCES } from "@/lib/preferences";

/**
 * Standalone filters bar that always renders, independent of book data.
 * Used outside the Suspense/data boundary so it's never hidden.
 */
export function LibraryFiltersBar() {
  const [viewMode, setViewMode] = useViewModePreference(
    LIST_PREFERENCES.library.view.key,
    LIBRARY_VIEW_MODES,
    LIST_PREFERENCES.library.view.fallback,
  );
  const [gridColumns, setGridColumns] = usePreference(
    LIST_PREFERENCES.library.grid.key,
    LIST_PREFERENCES.library.grid.fallback,
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
