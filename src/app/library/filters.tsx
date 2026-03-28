"use client";

import { EntityFilters } from "@/components/shared/entity-filters";
import type { ViewMode } from "@/components/books/view-mode-switcher";

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "title", label: "Title" },
  { value: "year", label: "Year" },
  { value: "rating", label: "Rating" },
];

interface LibraryFiltersProps {
  onViewModeChange?: (mode: ViewMode) => void;
  onGridColumnsChange?: (cols: number) => void;
  viewMode?: ViewMode;
  gridColumns?: number;
}

export function LibraryFilters({
  onViewModeChange,
  onGridColumnsChange,
  viewMode = "grid",
  gridColumns = 6,
}: LibraryFiltersProps) {
  return (
    <EntityFilters
      basePath="/library"
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search works..."
      defaultSort="recent"
      viewMode={viewMode}
      gridColumns={gridColumns}
      onViewModeChange={onViewModeChange ?? (() => {})}
      onGridColumnsChange={onGridColumnsChange ?? (() => {})}
    />
  );
}
