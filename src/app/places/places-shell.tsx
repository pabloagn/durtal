"use client";

import { useSearchParams } from "next/navigation";
import { usePreference } from "@/lib/hooks/use-preference";
import { VenueCard } from "@/components/venues/venue-card";
import { VenueListItem } from "@/components/venues/venue-list-item";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { COL_CLASSES } from "@/components/shared/grid-columns";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import type { VenueType } from "@/lib/actions/venues";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { LIST_PREFERENCES } from "@/lib/preferences";

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
  archived: boolean;
}

interface PlacesShellProps {
  venues: VenueItem[];
  /** Total venues matching the current search and filters (all pages) */
  total: number;
}

/** URL params (besides the search term) that filter the venue list */
const PLACE_FILTER_PARAMS = ["type", "favorite", "country", "archived"];

export function PlacesShell({ venues, total }: PlacesShellProps) {
  const searchParams = useSearchParams();

  // Written by PlacesFiltersBar; kept in sync through usePreference
  const [storedViewMode] = usePreference<ViewMode>(
    LIST_PREFERENCES.places.view.key,
    LIST_PREFERENCES.places.view.fallback,
  );
  const [gridColumns] = usePreference(
    LIST_PREFERENCES.places.grid.key,
    LIST_PREFERENCES.places.grid.fallback,
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
        <div className="@container">
          <div className={`grid gap-4 ${COL_CLASSES[gridColumns] ?? COL_CLASSES[4]}`}>
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
                archived={v.archived}
              />
            ))}
          </div>
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
              archived={v.archived}
            />
          ))}
        </div>
      )}
    </>
  );
}
