"use client";

import { firstPageHref } from "@/lib/utils/list-params";

import { useRouter, useSearchParams } from "next/navigation";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { EntityFilters } from "@/components/shared/entity-filters";
import {
  FilterDropdown,
  type AnyFilterGroup,
} from "@/components/shared/filter-dropdown";
import type { ViewMode } from "@/components/books/view-mode-switcher";

/** Offered only while a search is active; it is then the default sort */
const RELEVANCE_SORT = { value: "relevance", label: "Best match" };

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "editions", label: "Editions" },
  { value: "recent", label: "Recent" },
];

export const PUBLISHER_VIEW_MODES: ViewMode[] = ["grid", "list", "detailed"];

/** URL params (besides the search term) that filter the publisher list */
export const PUBLISHER_FILTER_PARAMS = ["favourites", "kind", "country"];

/**
 * Search, sort, filter and view controls for /publishers — the same toolbar
 * as authors and places. Rendered outside the results' Suspense boundary so
 * it stays mounted (and keeps focus) while results reload.
 */
export function PublishersFiltersBar({ countries }: { countries: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isSearching = !!searchParams.get("q")?.trim();

  const [viewMode, setViewMode] = useLocalStorage<ViewMode>(
    "durtal-publishers-view-mode",
    "grid",
  );
  const [gridColumns, setGridColumns] = useLocalStorage(
    "durtal-publishers-grid-columns",
    4,
  );

  const activeFilters: Record<string, string[]> = {
    favourites: searchParams.get("favourites") === "true" ? ["true"] : [],
    kind: searchParams.get("kind")?.split(",").filter(Boolean) ?? [],
    // Repeated params: a country name can never break the list
    country: searchParams.getAll("country").filter(Boolean),
  };

  const filterGroups: AnyFilterGroup[] = [
    {
      key: "favourites",
      label: "Favourites",
      options: [{ value: "true", label: "Favourites only" }],
    },
    {
      key: "kind",
      label: "Type",
      options: [
        { value: "group", label: "Group" },
        { value: "publisher", label: "Publisher" },
        { value: "imprint", label: "Imprint" },
      ],
    },
    ...(countries.length
      ? [
          {
            key: "country",
            label: "Country",
            options: countries.map((c) => ({ value: c, label: c })),
          } satisfies AnyFilterGroup,
        ]
      : []),
  ];

  function handleFilterChange(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    if (key === "favourites") {
      if (values.length) params.set("favourites", "true");
    } else if (key === "country") {
      for (const value of values) params.append("country", value);
    } else if (values.length) {
      params.set(key, values.join(","));
    }
    router.push(firstPageHref("/publishers", params));
  }

  function handleClearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of PUBLISHER_FILTER_PARAMS) params.delete(key);
    router.push(firstPageHref("/publishers", params));
  }

  return (
    <EntityFilters
      basePath="/publishers"
      sortOptions={
        isSearching ? [RELEVANCE_SORT, ...SORT_OPTIONS] : SORT_OPTIONS
      }
      searchPlaceholder="Search publishers..."
      defaultSort={isSearching ? "relevance" : "name"}
      defaultSortOrders={{
        relevance: "desc",
        name: "asc",
        editions: "desc",
        recent: "desc",
      }}
      viewMode={viewMode}
      gridColumns={gridColumns}
      onViewModeChange={setViewMode}
      onGridColumnsChange={setGridColumns}
      availableViewModes={PUBLISHER_VIEW_MODES}
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
