"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EntityFilters } from "@/components/shared/entity-filters";
import {
  FilterDropdown,
  type AnyFilterGroup,
} from "@/components/shared/filter-dropdown";
import { useHomeView } from "@/components/domains/domain-home-shell";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { firstPageHref } from "@/lib/utils/list-params";
import { PAINTING_FILTER_KEYS } from "@/lib/catalogue/painting-params";
import type { PaintingFilterOptions } from "@/lib/actions/paintings";

const VIEW_MODES: ViewMode[] = ["grid", "list"];

const SORT_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "created", label: "Date" },
  { value: "recent", label: "Added" },
  { value: "rating", label: "Rating" },
];
const DEFAULT_SORT_ORDERS = {
  title: "asc",
  created: "desc",
  recent: "desc",
  rating: "desc",
} as const;

/** The list filters, in the order of the menu */
const LIST_KEYS = [
  "painter",
  "movement",
  "genre",
  "technique",
  "medium",
  "support",
  "institution",
  "venue",
  "holding",
  "favourite",
] as const;

/** "Oil › Oil on canvas": an item under its broader one */
function itemLabel(item: { name: string; parentName: string | null }) {
  return item.parentName ? `${item.parentName} › ${item.name}` : item.name;
}

/**
 * Search, sort, view and filters of the painting home. Painters, movements,
 * institutions and venues match any one chosen; genres, techniques, media
 * and supports must all match. Every choice is in the URL, so a filtered
 * home can be linked.
 */
export function PaintingFilters({ options }: { options: PaintingFilterOptions }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = useHomeView("painting");
  const list = (key: string) =>
    searchParams.get(key)?.split(",").filter(Boolean) ?? [];

  const push = useCallback(
    (params: URLSearchParams) => router.push(firstPageHref("/paintings", params)),
    [router],
  );

  const handleFilterChange = useCallback(
    (key: string, values: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      let next = values;
      // Owned or not owned: choosing one replaces the other
      if (key === "holding") {
        const current = params.get("holding")?.split(",") ?? [];
        next = values.filter((v) => !current.includes(v)).slice(-1);
      }
      if (next.length) params.set(key, next.join(","));
      else params.delete(key);
      push(params);
    },
    [push, searchParams],
  );

  const handleClearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of PAINTING_FILTER_KEYS) params.delete(key);
    push(params);
  }, [push, searchParams]);

  const years = options.creationYears;
  const from = Number(searchParams.get("from")) || undefined;
  const to = Number(searchParams.get("to")) || undefined;
  const named = (rows: { id: string; name: string }[]) =>
    rows.map((row) => ({ value: row.id, label: row.name }));
  const terms = (rows: { id: string; name: string; parentName: string | null }[]) =>
    rows.map((row) => ({ value: row.id, label: itemLabel(row) }));
  const groups: AnyFilterGroup[] = [
    { key: "painter", label: "Painter", options: named(options.painters) },
    { key: "movement", label: "Movement", options: named(options.movements) },
    { key: "genre", label: "Genre", options: terms(options.genres) },
    { key: "technique", label: "Technique", options: terms(options.techniques) },
    { key: "medium", label: "Medium", options: terms(options.media) },
    { key: "support", label: "Support", options: terms(options.supports) },
    { key: "institution", label: "Owned by", options: named(options.institutions) },
    { key: "venue", label: "Now at", options: named(options.venues) },
    {
      key: "holding",
      label: "Collection",
      options: [
        { value: "owned", label: "In my collection" },
        { value: "not_owned", label: "Not in my collection" },
      ],
    },
    {
      key: "favourite",
      label: "Favourites",
      options: [{ value: "1", label: "Favourites only" }],
    },
    ...(years && years.min < years.max
      ? [
          {
            type: "range" as const,
            key: "created",
            label: "Date",
            min: years.min,
            max: years.max,
            value:
              from !== undefined || to !== undefined
                ? ([from ?? years.min, to ?? years.max] as [number, number])
                : undefined,
            onChange: ([lo, hi]: [number, number]) => {
              const params = new URLSearchParams(searchParams.toString());
              if (lo > years.min) params.set("from", String(lo));
              else params.delete("from");
              if (hi < years.max) params.set("to", String(hi));
              else params.delete("to");
              push(params);
            },
          },
        ]
      : []),
  ].filter((group) => "type" in group || group.options.length > 0);

  return (
    <EntityFilters
      basePath="/paintings"
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search paintings..."
      defaultSort="title"
      defaultSortOrders={DEFAULT_SORT_ORDERS}
      viewMode={view.viewMode}
      gridColumns={view.gridColumns}
      onViewModeChange={view.setViewMode}
      onGridColumnsChange={view.setGridColumns}
      availableViewModes={VIEW_MODES}
    >
      <FilterDropdown
        groups={groups}
        activeFilters={Object.fromEntries(LIST_KEYS.map((key) => [key, list(key)]))}
        onFilterChange={handleFilterChange}
        onClearAll={handleClearAll}
        activeRangeCount={from !== undefined || to !== undefined ? 1 : 0}
      />
    </EntityFilters>
  );
}
