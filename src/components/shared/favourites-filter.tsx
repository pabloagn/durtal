"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FilterDropdown } from "@/components/shared/filter-dropdown";
import { firstPageHref } from "@/lib/utils/list-params";
import {
  FAVOURITES_FILTER_GROUP,
  FAVOURITES_PARAM,
  favouritesOnly,
} from "@/lib/constants/favourites";

/**
 * The filter menu of a list that filters only by favourites: the same menu
 * and Favourites group as the lists with more filters.
 */
export function FavouritesFilter({ basePath }: { basePath: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function set(on: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (on) params.set(FAVOURITES_PARAM, "true");
    else params.delete(FAVOURITES_PARAM);
    router.push(firstPageHref(basePath, params));
  }

  return (
    <FilterDropdown
      groups={[FAVOURITES_FILTER_GROUP]}
      activeFilters={{
        [FAVOURITES_PARAM]: favouritesOnly(searchParams.get(FAVOURITES_PARAM))
          ? ["true"]
          : [],
      }}
      onFilterChange={(_, values) => set(values.length > 0)}
      onClearAll={() => set(false)}
    />
  );
}
