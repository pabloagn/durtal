"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import { firstPageHref } from "@/lib/utils/list-params";
import { NOTES_DEFAULT_ORDER } from "@/lib/reading/notes-params";

const BASE = "/reading/notes";
const PARAMS = ["book", "author", "kind", "fav", "year"];
/** One choice each: a new tick replaces the old one */
const SINGLE = new Set(["book", "author", "kind", "year"]);

export interface NotesFacets {
  books: { id: string; title: string; count: number }[];
  authors: { id: string; name: string }[];
  years: number[];
}

/** The commonplace book's search, sorts and filters, all in the URL (SLN-453) */
export function NotesFilters({ facets }: { facets: NotesFacets }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searching = !!searchParams.get("q")?.trim();
  const one = (key: string) => (searchParams.get(key) ? [searchParams.get(key)!] : []);

  const groups: AnyFilterGroup[] = [
    { key: "kind", label: "Kind", options: [{ value: "quote", label: "Quotes" }, { value: "note", label: "Notes" }] },
    { key: "fav", label: "Favourites", options: [{ value: "1", label: "Favourites only" }] },
    ...(facets.books.length > 1 ? [{ key: "book", label: "Book", options: facets.books.map((b) => ({ value: b.id, label: b.title })) }] : []),
    ...(facets.authors.length > 1 ? [{ key: "author", label: "Author", options: facets.authors.map((a) => ({ value: a.id, label: a.name })) }] : []),
    ...(facets.years.length > 1 ? [{ key: "year", label: "Year added", options: facets.years.map((y) => ({ value: String(y), label: String(y) })) }] : []),
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
      sortOptions={[
        ...(searching ? [{ value: "relevance", label: "Best match" }] : []),
        { value: "newest", label: "Newest" },
        { value: "book", label: "Book and page" },
      ]}
      searchPlaceholder="Search your quotes and notes..."
      defaultSort={searching ? "relevance" : "newest"}
      defaultSortOrders={NOTES_DEFAULT_ORDER}
    >
      <FilterDropdown
        groups={groups}
        activeFilters={{ kind: one("kind"), fav: searchParams.get("fav") === "1" ? ["1"] : [], book: one("book"), author: one("author"), year: one("year") }}
        onFilterChange={onFilterChange}
        onClearAll={onClearAll}
      />
    </EntityFilters>
  );
}
