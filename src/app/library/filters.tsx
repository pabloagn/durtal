"use client";

import { firstPageHref } from "@/lib/utils/list-params";
import { MARKS_LABEL, WORK_MARKS, parseMarks } from "@/lib/constants/marks";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import {
  EntityFilters,
  FILTER_ROW_CLASSES,
} from "@/components/shared/entity-filters";
import {
  FilterDropdown,
  type AnyFilterGroup,
  type FilterGroup,
  type RangeFilterGroup,
} from "@/components/shared/filter-dropdown";
import { ActiveFilters, type ActiveFilterChip } from "@/components/shared/active-filters";
import { WORK_READING_STATES, WORK_READING_STATE_LABELS } from "@/lib/reading/constants";
import { getLibraryFilterOptions } from "@/lib/actions/library-filters";
import { useLazyOptions } from "@/hooks/use-lazy-options";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import {
  BOOK_FILTER_KEYS,
  BOOK_TAXONOMY_FILTERS,
  COPY_FLAGS,
  POSTER_FILTERS,
  SERIES_FILTERS,
} from "@/lib/library/filter-keys";
import { COLOR_BUCKETS } from "@/lib/color/color-buckets";
import { COPY_FORMAT_LABELS } from "@/lib/constants/catalogue";
import { INSTANCE_FORMATS } from "@/lib/types";
import { languageName } from "@/lib/utils/language";

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

/** The panel's sections, in order (SLN-405) */
const SECTIONS = ["Collection", "Reading", "Marks", "Book", "Subjects", "Cover"];

/** Groups where one value replaces the other: two would cancel out, or mean nothing */
const SINGLE_KEYS = new Set(["holding", "series", "poster", "rating"]);

/** Every URL key a filter sets: Clear all removes them */
const FILTER_KEYS = ["status", "holding", "reading", "reread", "readFrom", "readTo", ...BOOK_FILTER_KEYS];

/** Range keys: a range is one chip, not a list */
const RANGES = [
  { key: "readIn", label: "Read in", from: "readFrom", to: "readTo" },
  { key: "published", label: "First published", from: "yearFrom", to: "yearTo" },
] as const;

/** Groups whose names come with the options: a chosen one loads them at once, for its chip */
const NAMED_KEYS = ["publisher", "location", ...BOOK_TAXONOMY_FILTERS.map((t) => t.key)];

interface LibraryFiltersProps {
  onViewModeChange?: (mode: ViewMode) => void;
  onGridColumnsChange?: (cols: number) => void;
  viewMode?: ViewMode;
  gridColumns?: number;
  availableViewModes?: ViewMode[];
}

/**
 * Search, sort, view and filters of the library (SLN-405). The filters sit
 * in one panel, by section: the collection and its copies, reading, marks,
 * the book itself, its subjects and its cover. Within a group any one value
 * matches; every group must match. The options and their counts load when the
 * panel is about to open. Each chosen filter shows as a chip under the bar.
 */
export function LibraryFilters({
  onViewModeChange,
  onGridColumnsChange,
  viewMode = "grid",
  gridColumns = 6,
  availableViewModes,
}: LibraryFiltersProps) {
  const { value: options, failed, start } = useLazyOptions(getLibraryFilterOptions);
  const router = useRouter();
  const searchParams = useSearchParams();
  const list = useCallback(
    (key: string) => searchParams.get(key)?.split(",").filter(Boolean) ?? [],
    [searchParams],
  );

  const needsNames = NAMED_KEYS.some((key) => list(key).length > 0);
  useEffect(() => {
    if (needsNames) start();
  }, [needsNames, start]);

  const push = useCallback(
    (params: URLSearchParams) => router.push(firstPageHref("/library", params)),
    [router],
  );

  const activeFilters: Record<string, string[]> = {};
  for (const key of FILTER_KEYS) activeFilters[key] = list(key);
  // The old `rare=true` link counts as the Rare mark
  activeFilters.mark = parseMarks([searchParams.get("mark"), searchParams.get("rare") === "true" ? "rare" : ""].join(","));
  activeFilters.reread = searchParams.get("reread") === "true" ? ["true"] : [];
  for (const key of ["rare", ...RANGES.flatMap((r) => [r.from, r.to])]) delete activeFilters[key];

  const rangeLabel = (from: string | null, to: string | null) =>
    from && to ? `${from}–${to}` : from ? `From ${from}` : `Up to ${to}`;

  /** A range group: a bound at its end of the span is no bound */
  const rangeGroup = (
    range: (typeof RANGES)[number],
    section: string,
    span: { min: number | null; max: number | null } | null | undefined,
  ): RangeFilterGroup[] => {
    if (!span || span.min === null || span.max === null || span.min >= span.max) return [];
    const { min, max } = span;
    const from = Number(searchParams.get(range.from)) || min;
    const to = Number(searchParams.get(range.to)) || max;
    return [
      {
        type: "range",
        key: range.key,
        label: range.label,
        section,
        min,
        max,
        value: [Math.max(min, from), Math.min(max, to)],
        active: searchParams.has(range.from) || searchParams.has(range.to),
        onChange: (val) => {
          const params = new URLSearchParams(searchParams.toString());
          if (val[0] !== min) params.set(range.from, String(val[0]));
          else params.delete(range.from);
          if (val[1] !== max) params.set(range.to, String(val[1]));
          else params.delete(range.to);
          push(params);
        },
      },
    ];
  };

  const formatCounts = options?.formats;
  const allGroups: AnyFilterGroup[] = [
    { section: "Collection", key: "status", label: "Status", options: STATUS_OPTIONS },
    { section: "Collection", key: "holding", label: "Holding", options: HOLDING_OPTIONS },
    { section: "Collection", key: "priority", label: "Priority", options: PRIORITY_OPTIONS },
    { section: "Collection", key: "location", label: "Location", options: options?.locations ?? [] },
    {
      section: "Collection",
      key: "format",
      label: "Format",
      options: formatCounts
        ? INSTANCE_FORMATS.filter((f) => formatCounts[f]).map((f) => ({
            value: f,
            label: COPY_FORMAT_LABELS[f],
            count: formatCounts[f],
          }))
        : [],
    },
    {
      section: "Collection",
      key: "copy",
      label: "Copy",
      options: COPY_FLAGS.map((f) => ({ value: f.value, label: f.label, count: options?.copies[f.value] })),
    },
    { section: "Reading", key: "reading", label: "Reading", options: READING_OPTIONS },
    { section: "Reading", key: "reread", label: "Re-read", options: REREAD_OPTIONS },
    ...rangeGroup(RANGES[0], "Reading", options?.readYears),
    {
      section: "Marks",
      key: "mark",
      label: MARKS_LABEL,
      options: WORK_MARKS.map((m) => ({ value: m.key, label: m.label })),
    },
    { section: "Marks", key: "rating", label: "Min rating", options: RATING_OPTIONS },
    { section: "Book", key: "lang", label: "Language", options: options?.languages ?? [] },
    { section: "Book", key: "origLang", label: "Original language", options: options?.originalLanguages ?? [] },
    ...rangeGroup(RANGES[1], "Book", options?.years),
    { section: "Book", key: "series", label: "Series", options: [...SERIES_FILTERS] },
    {
      section: "Book",
      key: "publisher",
      label: "Publisher",
      options: (options?.publishers ?? []).map((p) => ({
        value: p.id,
        label: `${p.name}${p.country ? ` · ${p.country}` : ""}`,
      })),
    },
    // A taxonomy no book uses is left out
    ...BOOK_TAXONOMY_FILTERS.filter((t) => !options || options.taxonomy[t.key].length > 0).map(
      (t): FilterGroup => ({ section: "Subjects", key: t.key, label: t.label, options: options?.taxonomy[t.key] ?? [] }),
    ),
    {
      section: "Cover",
      key: "color",
      label: "Colour",
      swatches: true,
      options: COLOR_BUCKETS.map((b) => ({
        value: b.key,
        label: b.label,
        swatch: b.swatch,
        count: options ? (options.colors[b.key] ?? 0) : undefined,
      })),
    },
    { section: "Cover", key: "poster", label: "Picture", options: [...POSTER_FILTERS] },
  ];

  // A group with nothing to choose is left out (a list loads with the options)
  const groups = allGroups.filter((g) => "type" in g || g.options.length > 0);

  const handleFilterChange = useCallback(
    (key: string, values: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      // `mark` replaces the old `rare` param
      if (key === "mark") params.delete("rare");
      let next = values;
      if (SINGLE_KEYS.has(key)) {
        const current = params.get(key)?.split(",") ?? [];
        next = values.filter((v) => !current.includes(v)).slice(-1);
      }
      if (next.length > 0) params.set(key, next.join(","));
      else params.delete(key);
      push(params);
    },
    [push, searchParams],
  );

  const handleClearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_KEYS) params.delete(key);
    push(params);
  }, [push, searchParams]);

  // One chip per chosen value, in the panel's order; a range is one chip,
  // shown from the URL before its span loads
  const chips: ActiveFilterChip[] = [];
  for (const group of allGroups) {
    if ("type" in group) continue;
    for (const value of activeFilters[group.key] ?? []) {
      const option = group.options.find((o) => o.value === value);
      const label =
        option?.label ??
        (group.key === "lang" || group.key === "origLang" ? (languageName(value) ?? value) : "…");
      chips.push({ key: group.key, value, group: group.label, label, swatch: option?.swatch });
    }
    if (group.key === "reread")
      for (const range of RANGES.filter((r) => r.key === "readIn")) {
        const [from, to] = [searchParams.get(range.from), searchParams.get(range.to)];
        if (from || to) chips.push({ key: range.key, group: range.label, label: rangeLabel(from, to) });
      }
    if (group.key === "origLang")
      for (const range of RANGES.filter((r) => r.key === "published")) {
        const [from, to] = [searchParams.get(range.from), searchParams.get(range.to)];
        if (from || to) chips.push({ key: range.key, group: range.label, label: rangeLabel(from, to) });
      }
  }

  const removeChip = useCallback(
    (chip: ActiveFilterChip) => {
      const params = new URLSearchParams(searchParams.toString());
      const range = RANGES.find((r) => r.key === chip.key);
      if (range) {
        params.delete(range.from);
        params.delete(range.to);
      } else {
        const rest = (params.get(chip.key)?.split(",") ?? []).filter((v) => v && v !== chip.value);
        if (rest.length) params.set(chip.key, rest.join(","));
        else params.delete(chip.key);
        if (chip.key === "mark" && chip.value === "rare") params.delete("rare");
      }
      push(params);
    },
    [push, searchParams],
  );

  const activeRangeCount = RANGES.filter((r) => searchParams.has(r.from) || searchParams.has(r.to)).length;

  return (
    <>
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
          sections={SECTIONS}
          activeRangeCount={activeRangeCount}
          groups={groups}
          activeFilters={activeFilters}
          onFilterChange={handleFilterChange}
          onClearAll={handleClearAll}
          onIntent={start}
          loading={!options && !failed}
          failed={failed}
        />
      </EntityFilters>
      <ActiveFilters chips={chips} onRemove={removeChip} onClearAll={handleClearAll} />
    </>
  );
}
