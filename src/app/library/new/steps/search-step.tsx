"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, Plus, ArrowRight, Loader2, ImageIcon } from "lucide-react";
import type { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import type { SearchResult } from "@/lib/api/types";
import { CapAligned } from "@/components/shared/cap-aligned";
import { Badge } from "@/components/ui/badge";
import { isComposing } from "@/lib/shortcuts/shortcuts";

/**
 * Search the sources by title, author or ISBN; a result fills in the book.
 * The search lives in the wizard, so going back to this step keeps it.
 */
export function SearchStep({
  search,
  onSelect,
  onManual,
  cancel,
}: {
  search: ReturnType<typeof useDebouncedSearch>;
  onSelect: (result: SearchResult) => void;
  onManual: () => void;
  cancel: ReactNode;
}) {
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    notices: searchNotices,
    isSearching,
    clearResults,
  } = search;
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Reset highlight when results change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchResults]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        clearResults();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [clearResults]);

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (!searchResults.length && e.key !== "Escape") return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((i) =>
          i < searchResults.length - 1 ? i + 1 : i,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((i) => (i > 0 ? i - 1 : i));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && searchResults[highlightedIndex]) {
          onSelect(searchResults[highlightedIndex]);
        }
        break;
      case "Escape":
        // Open results close first; with none, Esc leaves the field
        if (!searchResults.length || isComposing(e)) break;
        e.preventDefault();
        clearResults();
        setHighlightedIndex(-1);
        break;
    }
  }

  return (
    <div className="space-y-6">
      <div ref={searchContainerRef} className="relative">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            placeholder="Search by title, author, or ISBN..."
            data-shortcut-search=""
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="h-9 w-full rounded-sm border border-glass-border bg-bg-primary pl-9 pr-9 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none pointer-coarse:h-11"
            autoFocus
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-fg-muted" />
          )}
        </div>

        {/* Autocomplete dropdown */}
        {searchQuery.trim().length >= 2 &&
          (searchResults.length > 0 || isSearching || searchNotices.length > 0) && (
            // The glass never scrolls: its list does, inside it
            <div className="glass absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden">
              <div className="max-h-[420px] overflow-y-auto">
                {/* A source that could not answer, so "no results" is not misread */}
                {!isSearching &&
                  searchNotices.map((notice) => (
                    <p
                      key={notice}
                      role="status"
                      className="border-b border-glass-border/50 px-3 py-2.5 text-xs text-fg-secondary"
                    >
                      {notice}
                    </p>
                  ))}
                {searchResults.map((result, i) => (
                  <button
                    key={`${result.source}-${result.sourceId}-${i}`}
                    className={`flex w-full items-start gap-3 border-b border-glass-border/50 px-3 py-2.5 text-left transition-colors last:border-0 ${
                      highlightedIndex === i
                        ? "bg-bg-tertiary"
                        : "hover:bg-bg-tertiary"
                    }`}
                    onClick={() => onSelect(result)}
                    onMouseEnter={() => setHighlightedIndex(i)}
                  >
                    {/* Cover thumbnail */}
                    <div className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded-sm bg-bg-primary">
                      {result.coverUrl ? (
                        <img
                          src={result.coverUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <ImageIcon
                            className="h-3 w-3 text-fg-muted/40"
                            strokeWidth={1.5}
                          />
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <h3 className="type-item-title line-clamp-1">
                        {result.title}
                      </h3>
                      <p className="mt-0.5 line-clamp-1 text-xs text-fg-secondary">
                        {result.authors.join(", ") || "Unknown author"}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        {result.publicationYear && (
                          <span className="font-mono text-micro text-fg-secondary">
                            {result.publicationYear}
                          </span>
                        )}
                        {result.publisher && (
                          <span className="line-clamp-1 text-micro text-fg-secondary">
                            {result.publisher}
                          </span>
                        )}
                        <Badge variant="muted">
                          {result.source === "isbndb"
                            ? "ISBNdb"
                            : result.source.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>

                    {/* On the cap-height center of the title's first line */}
                    <CapAligned height={14} className="type-item-title">
                      <ArrowRight
                        className="h-3.5 w-3.5 text-fg-muted"
                        strokeWidth={1.5}
                      />
                    </CapAligned>
                  </button>
                ))}

                {isSearching && searchResults.length === 0 && (
                  <div className="flex items-center gap-2 px-3 py-4">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />
                    <span className="text-xs text-fg-secondary">
                      Searching...
                    </span>
                  </div>
                )}

                {!isSearching && searchResults.length === 0 &&
                  searchQuery.trim().length >= 2 && (
                    <div className="px-3 py-4 text-xs text-fg-secondary">
                      No books found. Try a different search or enter details
                      manually.
                    </div>
                  )}
              </div>
            </div>
          )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-glass-border pt-4">
        <button
          onClick={onManual}
          className="flex items-center gap-2 text-sm text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          Enter details manually
        </button>
        {cancel}
      </div>
    </div>
  );
}
