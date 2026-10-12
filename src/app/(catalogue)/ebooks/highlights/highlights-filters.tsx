"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type FilterGroup } from "@/components/shared/filter-dropdown";
import { firstPageHref } from "@/lib/utils/list-params";
import { ANNOTATION_COLORS } from "@/lib/reader/annotations";
import type { HighlightBookOption } from "@/lib/ebooks/highlights";

const BASE = "/ebooks/highlights";
const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "title", label: "Title" },
];
const KIND_OPTIONS = [
  { value: "highlight", label: "Highlights" },
  { value: "note", label: "With a note" },
  { value: "bookmark", label: "Bookmarks" },
];
const PARAMS = ["color", "kind", "ebook"];
/** One choice only: a new tick replaces the old one */
const SINGLE = new Set(["ebook"]);

/** Search, sort and filters of every mark across the library, all in the URL (SLN-500) */
export function HighlightsFilters({ books }: { books: HighlightBookOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const list = (key: string) => searchParams.get(key)?.split(",").filter(Boolean) ?? [];
  const groups: FilterGroup[] = [
    { key: "kind", label: "Kind", options: KIND_OPTIONS },
    {
      key: "color",
      label: "Colour",
      options: ANNOTATION_COLORS.map((color) => ({ value: color, label: color[0].toUpperCase() + color.slice(1) })),
    },
    ...(books.length > 1
      ? [{ key: "ebook", label: "eBook", options: books.map((book) => ({ value: book.id, label: `${book.title} (${book.marks})` })) }]
      : []),
  ];
  function onFilterChange(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    const next = SINGLE.has(key) ? values.slice(-1) : values;
    if (next.length) params.set(key, next.join(","));
    else params.delete(key);
    router.push(firstPageHref(BASE, params));
  }
  function onClearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of PARAMS) params.delete(key);
    router.push(firstPageHref(BASE, params));
  }
  return (
    <EntityFilters
      basePath={BASE}
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search highlights and notes..."
      defaultSort="newest"
      defaultSortOrders={{ newest: "desc", title: "asc" }}
    >
      <FilterDropdown
        groups={groups}
        activeFilters={{ kind: list("kind"), color: list("color"), ebook: list("ebook") }}
        onFilterChange={onFilterChange}
        onClearAll={onClearAll}
      />
    </EntityFilters>
  );
}
