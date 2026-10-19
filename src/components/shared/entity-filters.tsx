"use client";

import { useListSearchClear } from "@/lib/hooks/use-list-search-clear";

import { firstPageHref } from "@/lib/utils/list-params";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { Search, ArrowUp, ArrowDown } from "lucide-react";
import {
  ViewModeSwitcher,
  type ViewMode,
} from "@/components/books/view-mode-switcher";
import { GridSizeSlider } from "@/components/books/grid-size-slider";
import { useListBusy, useListNavigate } from "@/components/shared/list-pending";

/**
 * The filter row without its margin. On a phone the search takes its own row;
 * the sorts wrap, each label whole.
 */
export const FILTER_ROW_CLASSES =
  "flex flex-wrap items-center gap-3 [&>div:first-child]:min-w-0 [&>div:first-child]:basis-full sm:[&>div:first-child]:basis-48 [&>div:nth-child(2)]:flex-wrap [&>div:nth-child(2)>button]:whitespace-nowrap";

/** More sorts than this pick from a menu at every width, not chips */
const MAX_SORT_CHIPS = 6;

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
  /** Remember an explicit selection, including its direction. */
  onSortChange?: (sort: string, order: "asc" | "desc") => void;
  /** A list with one view (the reading journal) leaves these out: no view switch, no size slider */
  viewMode?: ViewMode;
  gridColumns?: number;
  onViewModeChange?: (mode: ViewMode) => void;
  onGridColumnsChange?: (cols: number) => void;
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
  onSortChange,
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
  const sortMenu = sortOptions.length > MAX_SORT_CHIPS;

  // The input is uncontrolled so typing never fights the URL. When the URL
  // changes from outside (a "clear" link, back/forward), copy the new query
  // into the input, unless the user is typing in it right now.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    if (input.value !== currentQuery) input.value = currentQuery;
  }, [currentQuery]);

  // Inside a ListPendingProvider the results show busy from the first key
  // until the new ones arrive (SLN-753)
  const list = useListBusy();
  const navigate = useListNavigate();
  const go = useCallback((href: string) => navigate(() => router.push(href)), [navigate, router]);

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      go(firstPageHref(basePath, params));
    },
    [go, searchParams, basePath],
  );

  useListSearchClear(inputRef, (navigate) => {
    clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>).__searchTimeout);
    if (navigate) updateParams("q", "");
  });

  // The same field again reverses its direction; another field starts at
  // its default direction
  function pickSort(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    const nextOrder = value === currentSort
      ? effectiveOrder === "asc" ? "desc" : "asc"
      : defaultSortOrders?.[value] ?? "asc";
    if (value === currentSort) {
      // Toggle direction
      const defaultOrder = defaultSortOrders?.[value] ?? "asc";
      if (nextOrder === defaultOrder) {
        params.delete("order"); // clean URL when using default
      } else {
        params.set("order", nextOrder);
      }
    } else {
      params.set("sort", value);
      params.delete("order"); // reset to default for new sort field
    }
    if (onSortChange) {
      // Keep the complete selection in the URL even when it uses
      // the default field/direction, so restoration cannot override it.
      params.set("sort", value);
      params.set("order", nextOrder);
      onSortChange(value, nextOrder);
    }
    go(firstPageHref(basePath, params));
  }

  return (
    // On a phone 16px to the count row, as on Books, so the first card
    // reaches the first screen (SLN-641). `data-view` is the view the switch
    // shows: the phone's card size rules key off it (globals.css), never a
    // :has() that restyles every page on each change (SLN-1249)
    <div className={className ?? `mb-4 sm:mb-6 ${FILTER_ROW_CLASSES}`} data-view={onViewModeChange ? viewMode : undefined}>
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
        <input
          ref={inputRef}
          type="text"
          // "/" focuses this field (keyboard shortcuts)
          data-shortcut-search=""
          aria-keyshortcuts="/"
          // Focus falls back here with no Filter button (SLN-838)
          data-list-focus="search"
          placeholder={searchPlaceholder}
          // A placeholder is not a name: it goes once text is typed
          aria-label={searchPlaceholder.replace(/(\.\.\.|…)$/, "")}
          defaultValue={currentQuery}
          onChange={(e) => {
            const val = e.target.value;
            list?.begin();
            clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>).__searchTimeout);
            (window as unknown as Record<string, ReturnType<typeof setTimeout>>).__searchTimeout = setTimeout(
              () => updateParams("q", val),
              300,
            );
          }}
          className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-primary focus:outline-none pointer-coarse:h-11"
        />
      </div>

      {/* Sort: chips from sm up, outlined like a segmented control (SLN-693); on
          a phone one menu for the field and one button for the direction, so
          eight sorts take one row (SLN-639). A list with more than six sorts
          (Books) keeps the menu at every width, so its toolbar fits one row
          at 1440 as every other list's does (SLN-1025) */}
      <div className="flex items-center gap-1 pointer-coarse:gap-2">
        <select
          aria-label="Sort by"
          value={currentSort}
          onChange={(e) => pickSort(e.target.value)}
          className={`h-8 rounded-sm border border-glass-border bg-bg-primary px-2 text-xs text-fg-primary pointer-coarse:h-11 ${sortMenu ? "" : "sm:hidden"}`}
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => pickSort(currentSort)}
          aria-label={effectiveOrder === "asc" ? "Ascending, reverse the order" : "Descending, reverse the order"}
          data-tooltip="Reverse the order"
          className={`flex h-8 w-8 items-center justify-center rounded-sm border border-glass-border text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:h-11 pointer-coarse:w-11 ${sortMenu ? "" : "sm:hidden"}`}
        >
          {effectiveOrder === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </button>
        {!sortMenu && sortOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => pickSort(opt.value)}
            aria-pressed={currentSort === opt.value}
            className={`h-8 rounded-sm border px-2.5 text-xs transition-colors pointer-coarse:h-11 max-sm:hidden ${
              currentSort === opt.value
                ? "border-accent-primary/40 bg-selection-bg text-fg-primary"
                : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
            }`}
          >
            {/* The arrow sits on the label's cap-height center */}
            {opt.label}
            {currentSort === opt.value &&
              (effectiveOrder === "asc" ? (
                <ArrowUp
                  className="ml-0.5 inline h-3 w-3 align-[calc(0.5cap-6px)]"
                  strokeWidth={1.5}
                />
              ) : (
                <ArrowDown
                  className="ml-0.5 inline h-3 w-3 align-[calc(0.5cap-6px)]"
                  strokeWidth={1.5}
                />
              ))}
          </button>
        ))}
      </div>

      {/* Custom filters */}
      {children}

      {/* View mode */}
      {viewMode && onViewModeChange && (
        <ViewModeSwitcher value={viewMode} onChange={onViewModeChange} availableModes={availableViewModes} />
      )}

      {/* Size slider: cards per row in the grid, pictures per row in the mosaic */}
      {(viewMode === "grid" || viewMode === "mosaic") && gridColumns !== undefined && onGridColumnsChange && (
        <GridSizeSlider value={gridColumns} onChange={onGridColumnsChange} />
      )}
    </div>
  );
}
