"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Search, ArrowUp, ArrowDown } from "lucide-react";
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
  defaultSortOrders?: Record<string, "asc" | "desc">;
  viewMode: ViewMode;
  gridColumns: number;
  onViewModeChange: (mode: ViewMode) => void;
  onGridColumnsChange: (cols: number) => void;
  availableViewModes?: ViewMode[];
  children?: React.ReactNode;
  className?: string;
}

export function EntityFilters({
  basePath,
  sortOptions,
  searchPlaceholder = "Search...",
  defaultSort,
  defaultSortOrders,
  viewMode,
  gridColumns,
  onViewModeChange,
  onGridColumnsChange,
  availableViewModes,
  children,
  className,
}: EntityFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolvedDefault = defaultSort ?? sortOptions[0]?.value ?? "";
  const currentSort = searchParams.get("sort") ?? resolvedDefault;
  const currentOrder = searchParams.get("order") as "asc" | "desc" | null;
  const effectiveOrder =
    currentOrder ?? defaultSortOrders?.[currentSort] ?? "asc";
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
    <div className={className ?? "mb-6 flex items-center gap-3"}>
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
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              if (opt.value === currentSort) {
                // Toggle direction
                const newOrder =
                  effectiveOrder === "asc" ? "desc" : "asc";
                const defaultOrder =
                  defaultSortOrders?.[opt.value] ?? "asc";
                if (newOrder === defaultOrder) {
                  params.delete("order"); // clean URL when using default
                } else {
                  params.set("order", newOrder);
                }
              } else {
                params.set("sort", opt.value);
                params.delete("order"); // reset to default for new sort field
              }
              params.delete("page");
              router.push(`${basePath}?${params.toString()}`);
            }}
            className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
              currentSort === opt.value
                ? "bg-accent-plum text-fg-primary"
                : "text-fg-muted hover:bg-bg-tertiary hover:text-fg-secondary"
            }`}
          >
            {opt.label}
            {currentSort === opt.value &&
              (effectiveOrder === "asc" ? (
                <ArrowUp
                  className="ml-0.5 inline h-3 w-3"
                  strokeWidth={1.5}
                />
              ) : (
                <ArrowDown
                  className="ml-0.5 inline h-3 w-3"
                  strokeWidth={1.5}
                />
              ))}
          </button>
        ))}
      </div>

      {/* Custom filters */}
      {children}

      {/* View mode */}
      <ViewModeSwitcher value={viewMode} onChange={onViewModeChange} availableModes={availableViewModes} />

      {/* Grid size slider (only in grid mode) */}
      {viewMode === "grid" && (
        <GridSizeSlider value={gridColumns} onChange={onGridColumnsChange} />
      )}
    </div>
  );
}
