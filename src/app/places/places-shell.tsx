"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import { VenueCard } from "@/components/venues/venue-card";
import { VenueListItem } from "@/components/venues/venue-list-item";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import type { VenueType } from "@/lib/actions/venues";

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recent" },
  { value: "rating", label: "Rating" },
];

const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

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

export interface VenueItem {
  id: string;
  slug: string;
  name: string;
  type: VenueType;
  formattedAddress: string | null;
  placeName: string | null;
  isFavorite: boolean;
  personalRating: number | null;
  website: string | null;
  thumbnailUrl: string | null;
  color: string | null;
  createdAt: string;
}

interface PlacesShellProps {
  venues: VenueItem[];
}

export function PlacesShell({ venues }: PlacesShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [viewMode, setViewMode] = useLocalStorage<ViewMode>(
    "durtal-places-view-mode",
    "grid",
  );
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
    <>
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
      >
        <FilterDropdown
          groups={filterGroups}
          activeFilters={activeFilters}
          onFilterChange={handleFilterChange}
          onClearAll={handleClearAll}
        />
      </EntityFilters>

      {viewMode === "grid" && (
        <div className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? "grid-cols-4"}`}>
          {venues.map((v) => (
            <VenueCard
              key={v.id}
              id={v.id}
              slug={v.slug}
              name={v.name}
              type={v.type}
              formattedAddress={v.formattedAddress}
              placeName={v.placeName}
              isFavorite={v.isFavorite}
              personalRating={v.personalRating}
              website={v.website}
              thumbnailUrl={v.thumbnailUrl}
              color={v.color}
            />
          ))}
        </div>
      )}

      {viewMode === "list" && (
        <div className="space-y-1">
          {venues.map((v) => (
            <VenueListItem
              key={v.id}
              id={v.id}
              slug={v.slug}
              name={v.name}
              type={v.type}
              formattedAddress={v.formattedAddress}
              placeName={v.placeName}
              isFavorite={v.isFavorite}
              personalRating={v.personalRating}
              website={v.website}
              thumbnailUrl={v.thumbnailUrl}
            />
          ))}
        </div>
      )}
    </>
  );
}
