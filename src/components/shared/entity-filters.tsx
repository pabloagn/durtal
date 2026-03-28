"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Search } from "lucide-react";
import {
  ViewModeSwitcher,
  type ViewMode,
} from "@/components/books/view-mode-switcher";
import { GridSizeSlider } from "@/components/books/grid-size-slider";

export interface SortOption {
  value: string;
  label: string;
}

interface EntityFiltersProps {
  basePath: string;
  sortOptions: SortOption[];
  searchPlaceholder?: string;
  defaultSort?: string;
  viewMode: ViewMode;
  gridColumns: number;
  onViewModeChange: (mode: ViewMode) => void;
  onGridColumnsChange: (cols: number) => void;
}

export function EntityFilters({
  basePath,
  sortOptions,
  searchPlaceholder = "Search...",
  defaultSort,
  viewMode,
  gridColumns,
  onViewModeChange,
  onGridColumnsChange,
}: EntityFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolvedDefault = defaultSort ?? sortOptions[0]?.value ?? "";
  const currentSort = searchParams.get("sort") ?? resolvedDefault;
  const currentQuery = searchParams.get("q") ?? "";

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.push(`${basePath}?${params.toString()}`);
    },
    [router, searchParams, basePath],
  );

  return (
    <div className="mb-6 flex items-center gap-3">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          defaultValue={currentQuery}
          onChange={(e) => {
            const val = e.target.value;
            clearTimeout((window as any).__searchTimeout);
            (window as any).__searchTimeout = setTimeout(
              () => updateParams("q", val),
              300,
            );
          }}
          className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none"
        />
      </div>

      {/* Sort */}
      <div className="flex items-center gap-1">
        {sortOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => updateParams("sort", opt.value)}
            className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
              currentSort === opt.value
                ? "bg-accent-plum text-fg-primary"
                : "text-fg-muted hover:bg-bg-tertiary hover:text-fg-secondary"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* View mode */}
      <ViewModeSwitcher value={viewMode} onChange={onViewModeChange} />

      {/* Grid size slider (only in grid mode) */}
      {viewMode === "grid" && (
        <GridSizeSlider value={gridColumns} onChange={onGridColumnsChange} />
      )}
    </div>
  );
}
