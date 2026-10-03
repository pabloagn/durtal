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
import { CONCENTRATION_LABELS } from "@/lib/catalogue/perfume-labels";
import { PERFUME_FILTER_KEYS } from "@/lib/catalogue/perfume-params";
import type { PerfumeFilterOptions } from "@/lib/actions/perfumes";

const VIEW_MODES: ViewMode[] = ["grid", "list"];

const SORT_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "release", label: "Release" },
  { value: "recent", label: "Added" },
  { value: "rating", label: "Rating" },
];
const DEFAULT_SORT_ORDERS = {
  title: "asc",
  release: "desc",
  recent: "desc",
  rating: "desc",
} as const;

/** "Oriental › Amber": an item under its broader one */
function itemLabel(item: { name: string; parentName: string | null }) {
  return item.parentName ? `${item.parentName} › ${item.name}` : item.name;
}

/**
 * Search, sort, view and filters of the perfume home. Houses, perfumers and
 * concentrations match any one chosen; families, accords and notes must all
 * match. Every choice is in the URL, so a filtered home can be linked.
 */
export function PerfumeFilters({ options }: { options: PerfumeFilterOptions }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = useHomeView("perfume");
  const list = (key: string) =>
    searchParams.get(key)?.split(",").filter(Boolean) ?? [];

  const push = useCallback(
    (params: URLSearchParams) => router.push(firstPageHref("/perfumes", params)),
    [router],
  );

  const handleFilterChange = useCallback(
    (key: string, values: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      let next = values;
      // In or not in the collection: choosing one replaces the other
      if (key === "holding") {
        const current = params.get("holding")?.split(",") ?? [];
        next = values.filter((v) => !current.includes(v)).slice(-1);
        if (next[0] === "not_owned") params.delete("container");
      }
      if (key === "container" && next.length) {
        if (params.get("holding") === "not_owned") params.delete("holding");
      }
      if (next.length) params.set(key, next.join(","));
      else params.delete(key);
      push(params);
    },
    [push, searchParams],
  );

  const handleClearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of PERFUME_FILTER_KEYS) params.delete(key);
    push(params);
  }, [push, searchParams]);

  const years = options.releaseYears;
  const from = Number(searchParams.get("from")) || undefined;
  const to = Number(searchParams.get("to")) || undefined;
  const groups: AnyFilterGroup[] = [
    {
      key: "house",
      label: "House",
      options: options.houses.map((h) => ({ value: h.id, label: h.name })),
    },
    {
      key: "perfumer",
      label: "Perfumer",
      options: options.perfumers.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      key: "family",
      label: "Family",
      options: options.families.map((f) => ({ value: f.id, label: itemLabel(f) })),
    },
    {
      key: "accord",
      label: "Accord",
      options: options.accords.map((a) => ({ value: a.id, label: itemLabel(a) })),
    },
    {
      key: "note",
      label: "Note",
      options: options.notes.map((n) => ({ value: n.id, label: itemLabel(n) })),
    },
    {
      key: "concentration",
      label: "Concentration",
      options: options.concentrations.map((c) => ({
        value: c,
        label: CONCENTRATION_LABELS[c].label,
      })),
    },
    {
      key: "holding",
      label: "Collection",
      options: [
        { value: "owned", label: "In my collection" },
        { value: "not_owned", label: "Not in my collection" },
      ],
    },
    {
      key: "container",
      label: "Containers",
      options: [
        { value: "bottle", label: "Bottles" },
        { value: "sample", label: "Samples" },
        { value: "decant", label: "Decants" },
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
            key: "release",
            label: "Release",
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
      basePath="/perfumes"
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search perfumes and houses..."
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
        activeFilters={Object.fromEntries(
          ["house", "perfumer", "family", "accord", "note", "concentration", "holding", "container", "favourite"].map(
            (key) => [key, list(key)],
          ),
        )}
        onFilterChange={handleFilterChange}
        onClearAll={handleClearAll}
        activeRangeCount={from !== undefined || to !== undefined ? 1 : 0}
      />
    </EntityFilters>
  );
}
