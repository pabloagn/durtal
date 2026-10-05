"use client";

import { firstPageHref } from "@/lib/utils/list-params";
import { MARKS_LABEL, WORK_MARKS, parseMarks } from "@/lib/constants/marks";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import {
  EntityFilters,
  FILTER_ROW_CLASSES,
} from "@/components/shared/entity-filters";
import {
  FilterDropdown,
  type AnyFilterGroup,
  type FilterGroup,
} from "@/components/shared/filter-dropdown";
import { WORK_READING_STATES, WORK_READING_STATE_LABELS } from "@/lib/reading/constants";
import { getReadYearRange } from "@/lib/actions/reading";
import type { ViewMode } from "@/components/books/view-mode-switcher";

import { getPublisherOptions } from "@/lib/actions/publishers";

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "title", label: "Title" },
  { value: "year", label: "Year" },
  { value: "rating", label: "Rating" },
  { value: "authorFirstName", label: "Author (first)" },
  { value: "authorLastName", label: "Author (last)" },
  { value: "lastRead", label: "Last read" },
  { value: "queue", label: "Up Next order" },
];

const DEFAULT_SORT_ORDERS: Record<string, "asc" | "desc"> = {
  recent: "desc",
  title: "asc",
  year: "desc",
  rating: "desc",
  authorFirstName: "asc",
  authorLastName: "asc",
  lastRead: "desc",
  queue: "asc",
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
  { value: "4.5", label: "4.5+ stars" },
  { value: "4", label: "4+ stars" },
  { value: "3.5", label: "3.5+ stars" },
  { value: "3", label: "3+ stars" },
];

const POSTER_OPTIONS = [
  { value: "missing", label: "Missing poster" },
  { value: "has", label: "Has poster" },
];

// Reading (SLN-449): the book's reading state, and whether a copy is held
const READING_OPTIONS = [
  ...WORK_READING_STATES.map((s) => ({ value: s, label: WORK_READING_STATE_LABELS[s] as string })),
  // Not a reading state: a queued book can be read or unread (SLN-452)
  { value: "queued", label: "In Up Next" },
];
const HOLDING_OPTIONS = [
  { value: "owned", label: "Owned" },
  { value: "not_owned", label: "Not owned" },
];
const REREAD_OPTIONS = [{ value: "true", label: "Re-reads only" }];

const FILTER_GROUPS: FilterGroup[] = [
  {
    key: "mark",
    label: MARKS_LABEL,
    options: WORK_MARKS.map((m) => ({ value: m.key, label: m.label })),
  },
  { key: "reading", label: "Reading", options: READING_OPTIONS },
  { key: "holding", label: "Holding", options: HOLDING_OPTIONS },
  { key: "reread", label: "Re-read", options: REREAD_OPTIONS },
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
  const [publishers, setPublishers] = useState<
    { id: string; name: string; country: string | null }[]
  >([]);
  // The years with a finished reading, for "Read in"
  const [readYears, setReadYears] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  useEffect(() => {
    let active = true;
    getPublisherOptions()
      .then((rows) => {
        if (active) setPublishers(rows);
      })
      .catch(() => {});
    getReadYearRange()
      .then((range) => {
        if (active) setReadYears(range);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeFilters: Record<string, string[]> = {
    publisher: searchParams.get("publisher")?.split(",").filter(Boolean) ?? [],
    // The old `rare=true` link counts as the Rare mark
    mark: parseMarks(
      [searchParams.get("mark"), searchParams.get("rare") === "true" ? "rare" : ""].join(","),
    ),
    status: searchParams.get("status")?.split(",").filter(Boolean) ?? [],
    priority: searchParams.get("priority")?.split(",").filter(Boolean) ?? [],
    rating: searchParams.get("rating")?.split(",").filter(Boolean) ?? [],
    poster: searchParams.get("poster")?.split(",").filter(Boolean) ?? [],
    reading: searchParams.get("reading")?.split(",").filter(Boolean) ?? [],
    holding: searchParams.get("holding")?.split(",").filter(Boolean) ?? [],
    reread: searchParams.get("reread") === "true" ? ["true"] : [],
  };

  // "Read in": a year range, as the people list's birth years
  const readMin = readYears.min ?? new Date().getFullYear();
  const readMax = readYears.max ?? new Date().getFullYear();
  const readFrom = Number(searchParams.get("readFrom")) || readMin;
  const readTo = Number(searchParams.get("readTo")) || readMax;
  const readRangeActive = readFrom !== readMin || readTo !== readMax;
  const readInGroup: AnyFilterGroup[] =
    readYears.min !== null && readYears.max !== null && readYears.min < readYears.max
      ? [
          {
            type: "range",
            key: "readIn",
            label: "Read in",
            min: readMin,
            max: readMax,
            value: [readFrom, readTo],
            onChange: (val: [number, number]) => {
              const params = new URLSearchParams(searchParams.toString());
              if (val[0] !== readMin) params.set("readFrom", String(val[0]));
              else params.delete("readFrom");
              if (val[1] !== readMax) params.set("readTo", String(val[1]));
              else params.delete("readTo");
              router.push(firstPageHref("/library", params));
            },
          },
        ]
      : [];

  const handleFilterChange = useCallback(
    (key: string, values: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      // `mark` replaces the old `rare` param
      if (key === "mark") params.delete("rare");
      if (values.length > 0) {
        params.set(key, values.join(","));
      } else {
        params.delete(key);
      }
      router.push(firstPageHref("/library", params));
    },
    [router, searchParams],
  );

  const handleClearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("publisher");
    params.delete("mark");
    params.delete("rare");
    params.delete("status");
    params.delete("priority");
    params.delete("rating");
    params.delete("location");
    params.delete("poster");
    for (const key of ["reading", "holding", "reread", "readFrom", "readTo"]) params.delete(key);
      router.push(firstPageHref("/library", params));
  }, [router, searchParams]);

  return (
    <EntityFilters
      basePath="/library"
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search works..."
      defaultSort="title"
      defaultSortOrders={DEFAULT_SORT_ORDERS}
      viewMode={viewMode}
      gridColumns={gridColumns}
      onViewModeChange={onViewModeChange ?? (() => {})}
      onGridColumnsChange={onGridColumnsChange ?? (() => {})}
      availableViewModes={availableViewModes}
      className={FILTER_ROW_CLASSES}
    >
      <FilterDropdown
        activeRangeCount={readRangeActive ? 1 : 0}
        groups={[
          ...FILTER_GROUPS,
          ...readInGroup,
          {
            key: "publisher",
            label: "Publisher",
            options: publishers.map((p) => ({
              value: p.id,
              label: `${p.name}${p.country ? ` · ${p.country}` : ""}`,
            })),
          },
        ]}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearAll={handleClearAll}
      />
    </EntityFilters>
  );
}
