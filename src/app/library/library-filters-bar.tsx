"use client";

import {
  usePreference,
  useViewModePreference,
} from "@/lib/hooks/use-preference";
import { LibraryFilters } from "./filters";
import { LIBRARY_VIEW_MODES } from "./view-modes";

/**
 * Standalone filters bar that always renders, independent of book data.
 * Used outside the Suspense/data boundary so it's never hidden.
 */
export function LibraryFiltersBar() {
  const [viewMode, setViewMode] = useViewModePreference(
    "durtal-view-mode",
    LIBRARY_VIEW_MODES,
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
