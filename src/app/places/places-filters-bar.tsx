"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import type { VenueType } from "@/lib/actions/venues";

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recent" },
  { value: "rating", label: "Rating" },
];

/** The places list only renders these two view modes */
const PLACES_VIEW_MODES: ViewMode[] = ["grid", "list"];

const ALL_VENUE_TYPES: VenueType[] = [
  "bookshop",
  "online_store",
  "cafe",
  "library",
  "museum",
  "gallery",
  "auction_house",
  "market",
  "fair",
  "publisher",
  "individual",
  "other",
];

const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  bookshop: "Bookshop",
  online_store: "Online Store",
  cafe: "Cafe",
  library: "Library",
  museum: "Museum",
  gallery: "Gallery",
  auction_house: "Auction House",
  market: "Market",
  fair: "Fair",
  publisher: "Publisher",
  individual: "Individual",
  other: "Other",
};

/**
 * Search, sort, filter and view controls for /places.
 * Rendered outside the results' Suspense boundary so it stays mounted (and
 * keeps focus) while results reload, and stays visible when nothing matches.
 */
export function PlacesFiltersBar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [storedViewMode, setViewMode] = useLocalStorage<ViewMode>(
    "durtal-places-view-mode",
    "grid",
  );
  // Older stored modes (e.g. "detailed") are not rendered for places
  const viewMode: ViewMode = storedViewMode === "list" ? "list" : "grid";
  const [gridColumns, setGridColumns] = useLocalStorage(
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
    params.delete("page");
    router.push(`/places?${params.toString()}`);
  }

  function handleClearAll() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("type");
    params.delete("favorite");
    params.delete("page");
    router.push(`/places?${params.toString()}`);
  }

  return (
    <EntityFilters
      basePath="/places"
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
