"use client";

import {
  usePreference,
  useViewModePreference,
} from "@/lib/hooks/use-preference";
import { LibraryFilters } from "./filters";
import { LIBRARY_VIEW_MODES } from "./view-modes";
import { LIST_PREFERENCES } from "@/lib/preferences";
import { useRouter, useSearchParams } from "next/navigation";
import { firstPageHref } from "@/lib/utils/list-params";

/**
 * Standalone filters bar that always renders, independent of book data.
 * Used outside the Suspense/data boundary so it's never hidden.
 */
export function LibraryFiltersBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ebook = searchParams.get("ebook");
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
      <div className="mt-2 flex items-center gap-2 text-xs text-fg-secondary">
        <label htmlFor="library-ebook-availability">eBooks</label>
        <select id="library-ebook-availability" value={ebook === "yes" || ebook === "no" ? ebook : ""}
          className="h-8 rounded-sm border border-glass-border bg-bg-primary px-2 text-xs text-fg-primary pointer-coarse:h-11"
          onChange={(event) => {
            const query = new URLSearchParams(searchParams.toString());
            if (event.target.value) query.set("ebook", event.target.value);
            else query.delete("ebook");
            router.push(firstPageHref("/library", query));
          }}>
          <option value="">All books</option>
          <option value="yes">Available in the reader</option>
          <option value="no">No readable eBook</option>
        </select>
      </div>
    </div>
  );
}
