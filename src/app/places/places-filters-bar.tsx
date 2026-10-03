"use client";

import { VENUE_TYPE_LABELS, VENUE_TYPES } from "@/lib/catalogue/venues";
import { firstPageHref } from "@/lib/utils/list-params";

import { useRouter, useSearchParams } from "next/navigation";
import { usePreference } from "@/lib/hooks/use-preference";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import type { ViewMode } from "@/components/books/view-mode-switcher";

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recent" },
  { value: "rating", label: "Rating" },
];

/** The places list only renders these two view modes */
const PLACES_VIEW_MODES: ViewMode[] = ["grid", "list"];

const ALL_VENUE_TYPES = VENUE_TYPES;


/**
 * Search, sort, filter and view controls for /places.
 * Rendered outside the results' Suspense boundary so it stays mounted (and
 * keeps focus) while results reload, and stays visible when nothing matches.
 */
export function PlacesFiltersBar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [storedViewMode, setViewMode] = usePreference<ViewMode>(
    "durtal-places-view-mode",
    "grid",
  );
  // Older stored modes (e.g. "detailed") are not rendered for places
  const viewMode: ViewMode = storedViewMode === "list" ? "list" : "grid";
  const [gridColumns, setGridColumns] = usePreference(
    "durtal-places-grid-columns",
    4,
  );

  // --- Active filter values from URL ---
  const activeFilters: Record<string, string[]> = {
    type: searchParams.get("type")?.split(",").filter(Boolean) ?? [],
    favorite: searchParams.get("favorite") ? [searchParams.get("favorite")!] : [],
  };

  const filterGroups: AnyFilterGroup[] = [
    {
      key: "type",
      label: "Type",
      options: ALL_VENUE_TYPES.map((t) => ({
        value: t,
        label: VENUE_TYPE_LABELS[t],
      })),
    },
    {
      key: "favorite",
      label: "Favorites",
      options: [{ value: "true", label: "Favorites only" }],
    },
  ];

  function handleFilterChange(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "favorite") {
      if (values.length > 0) {
        params.set("favorite", "true");
      } else {
        params.delete("favorite");
      }
    } else if (values.length > 0) {
      params.set(key, values.join(","));
    } else {
      params.delete(key);
    }
      router.push(firstPageHref("/places", params));
  }

  function handleClearAll() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("type");
    params.delete("favorite");
      router.push(firstPageHref("/places", params));
  }

  return (
    <EntityFilters
      basePath="/places"
      className="mb-6 flex flex-wrap items-center gap-3 [&>div:first-child]:min-w-0 [&>div:first-child]:basis-full sm:[&>div:first-child]:basis-48 [&>div:nth-child(2)]:shrink-0 [&>div:nth-child(2)]:whitespace-nowrap"
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search venues..."
      defaultSort="name"
      defaultSortOrders={{ name: "asc", recent: "desc", rating: "desc" }}
      viewMode={viewMode}
      gridColumns={gridColumns}
      onViewModeChange={setViewMode}
      onGridColumnsChange={setGridColumns}
      availableViewModes={PLACES_VIEW_MODES}
    >
      <FilterDropdown
        groups={filterGroups}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearAll={handleClearAll}
      />
    </EntityFilters>
  );
}
