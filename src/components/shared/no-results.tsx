"use client";

import Link from "next/link";
import { FileQuestion, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

interface NoResultsProps {
  /** Plural noun for the listed items, e.g. "authors" */
  noun: string;
  /** Active search term, if any */
  search?: string | null;
  /** Whether any filter (other than the search term) is active */
  hasFilters: boolean;
  /** URL with the search and filters removed */
  clearHref: string;
}

/**
 * Shown below a list toolbar when the search or filters match nothing.
 * The toolbar stays visible so the query can be edited.
 */
export function NoResults({ noun, search, hasFilters, clearHref }: NoResultsProps) {
  const description = search
    ? hasFilters
      ? `No ${noun} match "${search}" with the current filters.`
      : `No ${noun} match "${search}".`
    : `No ${noun} match the current filters.`;
  const clearLabel =
    search && hasFilters ? "Clear search and filters" : search ? "Clear search" : "Clear filters";

  return (
    <EmptyState
      icon={SearchX}
      title={`No ${noun} found`}
      description={description}
      action={
        <Link href={clearHref}>
          <Button variant="ghost" size="sm">
            {clearLabel}
          </Button>
        </Link>
      }
    />
  );
}

interface PageOutOfRangeProps {
  /** URL of the first page, with the current search and filters */
  firstPageHref: string;
}

/** Shown when the page number is past the last page of results. */
export function PageOutOfRange({ firstPageHref }: PageOutOfRangeProps) {
  return (
    <EmptyState
      icon={FileQuestion}
      title="Nothing on this page"
      description="This page is past the end of the results."
      action={
        <Link href={firstPageHref}>
          <Button variant="ghost" size="sm">
            Go to first page
          </Button>
        </Link>
      }
    />
  );
}
