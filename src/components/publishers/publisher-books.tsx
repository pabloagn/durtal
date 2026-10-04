"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EntityFilters, FILTER_ROW_CLASSES } from "@/components/shared/entity-filters";
import { FilterDropdown, type AnyFilterGroup, type FilterGroup } from "@/components/shared/filter-dropdown";
import { Pagination, type PaginationData } from "@/components/shared/pagination";
import { LibraryView } from "@/components/books/library-view";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { usePreference, useViewModePreference } from "@/lib/hooks/use-preference";
import { firstPageHref } from "@/lib/utils/list-params";
import { WORK_MARKS, MARKS_LABEL } from "@/lib/constants/marks";
import { languageName } from "@/lib/utils/language";
import { bindingLabel } from "@/lib/utils/binding";
import type { PublisherBook, PublisherBookFacets } from "@/lib/publishers/books";

const VIEW_MODES: ViewMode[] = ["grid", "list"];
const VIEW_KEY = "durtal-publisher-books-view-mode";
const GRID_KEY = "durtal-publisher-books-grid-columns";

const SORT_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "year", label: "Year" },
  { value: "recent", label: "Recent" },
];
const DEFAULT_SORT_ORDERS: Record<string, "asc" | "desc"> = {
  title: "asc",
  author: "asc",
  year: "desc",
  recent: "desc",
};

/** URL parameters the filters set; "Clear" removes them all */
const FILTER_KEYS = ["state", "mark", "language", "binding", "yearMin", "yearMax", "author", "imprint", "filter"];

/** The filter, sort and view row of a publisher's books */
export function PublisherBooksFilters({
  basePath,
  facets,
}: {
  basePath: string;
  facets: PublisherBookFacets;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useViewModePreference(VIEW_KEY, VIEW_MODES, "grid");
  const [gridColumns, setGridColumns] = usePreference(GRID_KEY, 5);

  const values = (key: string) => searchParams.get(key)?.split(",").filter(Boolean) ?? [];
  const legacy = searchParams.get("filter");
  const active: Record<string, string[]> = {
    state: values("state").length ? values("state") : legacy && legacy !== "all" ? [legacy] : [],
    mark: values("mark"),
    language: values("language"),
    binding: values("binding"),
    author: values("author"),
    imprint: values("imprint"),
  };

  const groups: FilterGroup[] = [
    {
      key: "state",
      label: "Status",
      options: [
        { value: "owned", label: "Owned" },
        { value: "wanted", label: "Wanted" },
        { value: "on_order", label: "On order" },
      ],
    },
    {
      key: "mark",
      label: MARKS_LABEL,
      options: WORK_MARKS.map((m) => ({
        value: m.key,
        label: m.label,
      })),
    },
    ...(facets.imprints.length
      ? [{
          key: "imprint",
          label: "Imprint",
          options: facets.imprints.map((i) => ({ value: i.id, label: `${i.name} · ${i.count}` })),
        }]
      : []),
    {
      key: "language",
      label: "Language",
      options: facets.languages.map((l) => ({ value: l.value, label: `${languageName(l.value)} · ${l.count}` })),
    },
    {
      key: "binding",
      label: "Binding",
      options: facets.bindings.map((b) => ({ value: b.value, label: `${bindingLabel(b.value)} · ${b.count}` })),
    },
    {
      key: "author",
      label: "Author",
      options: facets.authors.map((a) => ({ value: a.id, label: `${a.name} · ${a.count}` })),
    },
  ].filter((group) => group.options.length > 0);

  // Edition years, as a range from the earliest to the latest
  const { min, max } = facets.years;
  const yearMin = Number(searchParams.get("yearMin")) || min;
  const yearMax = Number(searchParams.get("yearMax")) || max;
  const rangeActive = !!(searchParams.get("yearMin") || searchParams.get("yearMax"));
  const allGroups: AnyFilterGroup[] =
    min != null && max != null && min < max
      ? [
          ...groups.slice(0, 3),
          {
            type: "range",
            key: "year",
            label: "Published",
            min,
            max,
            value: [yearMin!, yearMax!],
            onChange: ([from, to]: [number, number]) => {
              const params = new URLSearchParams(searchParams.toString());
              if (from !== min) params.set("yearMin", String(from));
              else params.delete("yearMin");
              if (to !== max) params.set("yearMax", String(to));
              else params.delete("yearMax");
              router.push(firstPageHref(basePath, params));
            },
          },
          ...groups.slice(3),
        ]
      : groups;

  const onFilterChange = useCallback(
    (key: string, next: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      // The old status tabs set `filter`; the Status group replaces it
      if (key === "state") params.delete("filter");
      if (next.length) params.set(key, next.join(","));
      else params.delete(key);
      router.push(firstPageHref(basePath, params));
    },
    [router, searchParams, basePath],
  );

  const onClearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_KEYS) params.delete(key);
    router.push(firstPageHref(basePath, params));
  }, [router, searchParams, basePath]);

  return (
    <div className="mb-4">
      <EntityFilters
        basePath={basePath}
        sortOptions={SORT_OPTIONS}
        searchPlaceholder="Search books..."
        defaultSort="title"
        defaultSortOrders={DEFAULT_SORT_ORDERS}
        viewMode={viewMode}
        gridColumns={gridColumns}
        onViewModeChange={setViewMode}
        onGridColumnsChange={setGridColumns}
        availableViewModes={VIEW_MODES}
        className={FILTER_ROW_CLASSES}
      >
        <FilterDropdown
          groups={allGroups}
          activeFilters={active}
          onFilterChange={onFilterChange}
          onClearAll={onClearAll}
          activeRangeCount={rangeActive ? 1 : 0}
        />
      </EntityFilters>
    </div>
  );
}

/** A publisher's books in the chosen view, with pagination above and below */
export function PublisherBooksView({
  books,
  pagination,
}: {
  books: PublisherBook[];
  pagination: PaginationData;
}) {
  const [viewMode] = useViewModePreference(VIEW_KEY, VIEW_MODES, "grid");
  const [gridColumns] = usePreference(GRID_KEY, 5);
  return (
    <>
      <Pagination {...pagination} noun="books" compact />
      <LibraryView books={books} viewMode={viewMode} gridColumns={gridColumns} />
      <Pagination {...pagination} noun="books" />
    </>
  );
}
