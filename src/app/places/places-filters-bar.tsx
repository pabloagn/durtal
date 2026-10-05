"use client";

import { FAVOURITES_PARAM, favouritesOnly } from "@/lib/constants/favourites";
import { VENUE_TYPE_LABELS, VENUE_TYPES } from "@/lib/catalogue/venues";
import { firstPageHref } from "@/lib/utils/list-params";

import { useRouter, useSearchParams } from "next/navigation";
import { usePreference } from "@/lib/hooks/use-preference";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { LIST_PREFERENCES } from "@/lib/preferences";

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recent" },
  { value: "rating", label: "Rating" },
];

/** The places list only renders these two view modes */
const PLACES_VIEW_MODES: ViewMode[] = LIST_PREFERENCES.places.view.modes;

const ALL_VENUE_TYPES = VENUE_TYPES;


/**
 * Search, sort, filter and view controls for /places.
 * Rendered outside the results' Suspense boundary so it stays mounted (and
 * keeps focus) while results reload, and stays visible when nothing matches.
 */
export function PlacesFiltersBar({
  countries = [],
}: {
  /** The countries of the venues, from their places */
  countries?: { id: string; name: string; count: number }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [storedViewMode, setViewMode] = usePreference<ViewMode>(
    LIST_PREFERENCES.places.view.key,
    LIST_PREFERENCES.places.view.fallback,
  );
  // Older stored modes (e.g. "detailed") are not rendered for places
  const viewMode: ViewMode = storedViewMode === "list" ? "list" : "grid";
  const [gridColumns, setGridColumns] = usePreference(
    LIST_PREFERENCES.places.grid.key,
    LIST_PREFERENCES.places.grid.fallback,
  );

  // --- Active filter values from URL ---
  const activeFilters: Record<string, string[]> = {
    type: searchParams.get("type")?.split(",").filter(Boolean) ?? [],
    favourites: favouritesOnly(searchParams.get(FAVOURITES_PARAM)) ? ["true"] : [],
    country: searchParams.get("country")?.split(",").filter(Boolean) ?? [],
    archived: searchParams.get("archived") ? [searchParams.get("archived")!] : [],
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
      key: "country",
      label: "Country",
      options: countries.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      key: FAVOURITES_PARAM,
      label: "Favourites",
      options: [{ value: "true", label: "Favourites only" }],
    },
    {
      key: "archived",
      label: "Archived",
      options: [
        { value: "include", label: "Include archived" },
        { value: "only", label: "Archived only" },
      ],
    },
  ].filter((group) => group.options.length > 0);

  function handleFilterChange(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "archived") {
      // One choice at a time: the newest replaces the other
      const current = params.get("archived");
      const next = values.filter((v) => v !== current).at(-1) ?? values[0];
      if (next) params.set("archived", next);
      else params.delete("archived");
    } else if (key === FAVOURITES_PARAM) {
      if (values.length > 0) {
        params.set(FAVOURITES_PARAM, "true");
      } else {
        params.delete(FAVOURITES_PARAM);
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
    for (const key of ["type", FAVOURITES_PARAM, "country", "archived"]) params.delete(key);
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
