"use client";

import { FavouritesFilter } from "@/components/shared/favourites-filter";
import { EntityFilters } from "@/components/shared/entity-filters";
import { usePreference, useViewModePreference } from "@/lib/hooks/use-preference";
import { LIST_PREFERENCES } from "@/lib/preferences";

const VIEW = LIST_PREFERENCES.collections.view;
const GRID = LIST_PREFERENCES.collections.grid;

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recent" },
  { value: "size", label: "Size" },
];

/**
 * Search, sort and view controls for /collections: the shared toolbar, so
 * its search runs as you type and its sort lives in the address, as on every
 * other list (SLN-845, SLN-1059)
 */
export function CollectionsFiltersBar() {
  const [view, setView] = useViewModePreference(VIEW.key, VIEW.modes, VIEW.fallback);
  const [size, setSize] = usePreference(GRID.key, GRID.fallback);
  return (
    <EntityFilters
      basePath="/collections"
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search collections..."
      defaultSort="name"
      defaultSortOrders={{ name: "asc", recent: "desc", size: "desc" }}
      viewMode={view}
      gridColumns={size}
      onViewModeChange={(mode) => {
        const next = VIEW.modes.find((m) => m === mode);
        if (next) setView(next);
      }}
      onGridColumnsChange={setSize}
      availableViewModes={VIEW.modes}
    >
      <FavouritesFilter basePath="/collections" />
    </EntityFilters>
  );
}
