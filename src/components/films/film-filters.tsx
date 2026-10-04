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
import { FILM_FILTER_KEYS } from "@/lib/catalogue/film-params";
import { getFilmFilterOptions } from "@/lib/actions/films";
import { useLazyOptions } from "@/hooks/use-lazy-options";

const VIEW_MODES: ViewMode[] = ["grid", "list"];

const SORT_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "release", label: "Release" },
  { value: "runtime", label: "Runtime" },
  { value: "recent", label: "Added" },
  { value: "rating", label: "Rating" },
];
const DEFAULT_SORT_ORDERS = {
  title: "asc",
  release: "desc",
  runtime: "desc",
  recent: "desc",
  rating: "desc",
} as const;

/** The list filters, besides the release years */
const LIST_KEYS = [
  "director",
  "cast",
  "genre",
  "language",
  "country",
  "holding",
  "medium",
  "favourite",
] as const;

/** "Horror › Body horror": a genre under its broader one */
function itemLabel(item: { name: string; parentName: string | null }) {
  return item.parentName ? `${item.parentName} › ${item.name}` : item.name;
}

/**
 * Search, sort, view and filters of the film home. Directors, cast,
 * languages and countries match any one chosen; genres must all match; a
 * director and a cast member must both match. Every choice is in the URL, so
 * a filtered home can be linked.
 */
export function FilmFilters() {
  // The options load when the filter panel is about to open, not with the page
  const { value: options, failed, start } = useLazyOptions(getFilmFilterOptions);
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = useHomeView("film");
  const list = (key: string) =>
    searchParams.get(key)?.split(",").filter(Boolean) ?? [];

  const push = useCallback(
    (params: URLSearchParams) => router.push(firstPageHref("/films", params)),
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
        if (next[0] === "not_owned") params.delete("medium");
      }
      if (key === "medium" && next.length) {
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
    for (const key of FILM_FILTER_KEYS) params.delete(key);
    push(params);
  }, [push, searchParams]);

  const years = options?.releaseYears ?? null;
  const from = Number(searchParams.get("from")) || undefined;
  const to = Number(searchParams.get("to")) || undefined;
  const groups: AnyFilterGroup[] = !options ? [] : [
    {
      key: "director",
      label: "Director",
      options: options.directors.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      key: "cast",
      label: "Cast",
      options: options.cast.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      key: "genre",
      label: "Genre",
      options: options.genres.map((g) => ({ value: g.id, label: itemLabel(g) })),
    },
    {
      key: "language",
      label: "Language",
      options: options.languages.map((l) => ({ value: l.id, label: l.name })),
    },
    {
      key: "country",
      label: "Country",
      options: options.countries.map((c) => ({ value: c.id, label: c.name })),
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
      key: "medium",
      label: "Copies",
      options: [
        { value: "physical", label: "Physical" },
        { value: "digital", label: "Digital" },
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
      basePath="/films"
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search films and original titles..."
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
        onIntent={start}
        loading={!options && !failed}
        failed={failed}
        activeFilters={Object.fromEntries(LIST_KEYS.map((key) => [key, list(key)]))}
        onFilterChange={handleFilterChange}
        onClearAll={handleClearAll}
        activeRangeCount={from !== undefined || to !== undefined ? 1 : 0}
      />
    </EntityFilters>
  );
}
