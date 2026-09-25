"use client";

import { useSearchParams } from "next/navigation";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { VenueCard } from "@/components/venues/venue-card";
import { VenueListItem } from "@/components/venues/venue-list-item";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import type { VenueType } from "@/lib/actions/venues";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";

const COL_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
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
  /** Total venues matching the current search and filters (all pages) */
  total: number;
}

/** URL params (besides the search term) that filter the venue list */
const PLACE_FILTER_PARAMS = ["type", "favorite"];

export function PlacesShell({ venues, total }: PlacesShellProps) {
  const searchParams = useSearchParams();

  // Written by PlacesFiltersBar; kept in sync through useLocalStorage events
  const [storedViewMode] = useLocalStorage<ViewMode>(
    "durtal-places-view-mode",
    "grid",
  );
  const [gridColumns] = useLocalStorage(
    "durtal-places-grid-columns",
    4,
  );
  // Only grid and list exist for places; older stored modes fall back to grid
  const viewMode = storedViewMode === "list" ? "list" : "grid";

  if (total === 0) {
    return (
      <NoResults
        noun="venues"
        search={searchParams.get("q")}
        hasFilters={PLACE_FILTER_PARAMS.some((key) => searchParams.get(key))}
        clearHref={clearedListHref("/places", searchParams)}
      />
    );
  }

  // Page number past the last page
  if (venues.length === 0) {
    return <PageOutOfRange firstPageHref={firstPageHref("/places", searchParams)} />;
  }

  return (
    <>
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
