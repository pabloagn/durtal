"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { EntityFilters } from "@/components/shared/entity-filters";
import {
  FilterDropdown,
  type FilterGroup,
} from "@/components/shared/filter-dropdown";
import type { ViewMode } from "@/components/books/view-mode-switcher";

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "title", label: "Title" },
  { value: "year", label: "Year" },
  { value: "rating", label: "Rating" },
  { value: "authorFirstName", label: "Author (first)" },
  { value: "authorLastName", label: "Author (last)" },
];

const DEFAULT_SORT_ORDERS: Record<string, "asc" | "desc"> = {
  recent: "desc",
  title: "asc",
  year: "desc",
  rating: "desc",
  authorFirstName: "asc",
  authorLastName: "asc",
};

const STATUS_OPTIONS = [
  { value: "accessioned", label: "Accessioned" },
  { value: "wanted", label: "Wanted" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "tracked", label: "Tracked" },
  { value: "on_order", label: "On Order" },
  { value: "deaccessioned", label: "Deaccessioned" },
];

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const RATING_OPTIONS = [
  { value: "5", label: "5 stars" },
  { value: "4", label: "4+ stars" },
  { value: "3", label: "3+ stars" },
];

const POSTER_OPTIONS = [
  { value: "missing", label: "Missing poster" },
  { value: "has", label: "Has poster" },
];

const FILTER_GROUPS: FilterGroup[] = [
  { key: "status", label: "Status", options: STATUS_OPTIONS },
  { key: "priority", label: "Priority", options: PRIORITY_OPTIONS },
  { key: "rating", label: "Min Rating", options: RATING_OPTIONS },
  { key: "poster", label: "Media", options: POSTER_OPTIONS },
];

interface LibraryFiltersProps {
  onViewModeChange?: (mode: ViewMode) => void;
  onGridColumnsChange?: (cols: number) => void;
  viewMode?: ViewMode;
  gridColumns?: number;
  availableViewModes?: ViewMode[];
}

export function LibraryFilters({
  onViewModeChange,
  onGridColumnsChange,
  viewMode = "grid",
  gridColumns = 6,
  availableViewModes,
}: LibraryFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeFilters: Record<string, string[]> = {
    status: searchParams.get("status")?.split(",").filter(Boolean) ?? [],
    priority: searchParams.get("priority")?.split(",").filter(Boolean) ?? [],
    rating: searchParams.get("rating")?.split(",").filter(Boolean) ?? [],
    poster: searchParams.get("poster")?.split(",").filter(Boolean) ?? [],
  };

  const handleFilterChange = useCallback(
    (key: string, values: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (values.length > 0) {
        params.set(key, values.join(","));
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.push(`/library?${params.toString()}`);
    },
    [router, searchParams],
  );

  const handleClearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("status");
    params.delete("priority");
    params.delete("rating");
    params.delete("location");
    params.delete("poster");
    params.delete("page");
    router.push(`/library?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <EntityFilters
      basePath="/library"
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search works..."
      defaultSort="recent"
      defaultSortOrders={DEFAULT_SORT_ORDERS}
      viewMode={viewMode}
      gridColumns={gridColumns}
      onViewModeChange={onViewModeChange ?? (() => {})}
      onGridColumnsChange={onGridColumnsChange ?? (() => {})}
      availableViewModes={availableViewModes}
      className="flex flex-1 items-center gap-3"
    >
      <FilterDropdown
        groups={FILTER_GROUPS}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearAll={handleClearAll}
      />
    </EntityFilters>
  );
}
