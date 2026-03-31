"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import { Search, MapPin, Loader2, X } from "lucide-react";
import type { GooglePlaceResult } from "@/app/api/venues/search-places/route";

export type { GooglePlaceResult };

interface GooglePlacesSearchProps {
  onSelect: (place: GooglePlaceResult) => void;
  placeholder?: string;
  disabled?: boolean;
}

const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 2;

export function GooglePlacesSearch({
  onSelect,
  placeholder = "Search for a venue, bookshop, café…",
  disabled = false,
}: GooglePlacesSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GooglePlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);

  // Search function
  const search = useCallback(async (q: string) => {
    if (q.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsOpen(false);
      setError(null);
      return;
    }

    // Cancel previous request
    if (abortController.current) {
      abortController.current.abort();
    }
    abortController.current = new AbortController();

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/venues/search-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() }),
        signal: abortController.current.signal,
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Search failed");
      }

      const data = (await res.json()) as { results: GooglePlaceResult[] };
      setResults(data.results ?? []);
      setIsOpen(true);
      setActiveIndex(-1);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        err instanceof Error ? err.message : "Search failed. Please try again.",
      );
      setResults([]);
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced effect
  useEffect(() => {
    if (selectedName !== null) return; // Don't re-search after selection

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void search(query);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, search, selectedName]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(place: GooglePlaceResult) {
    setSelectedName(place.name);
    setQuery(place.name);
    setResults([]);
    setIsOpen(false);
    setActiveIndex(-1);
    onSelect(place);
  }

  function handleClear() {
    setQuery("");
    setSelectedName(null);
    setResults([]);
    setIsOpen(false);
    setError(null);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function handleInputChange(value: string) {
    setQuery(value);
    if (selectedName !== null) {
      // User is editing after selection — reset
      setSelectedName(null);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      const place = results[activeIndex];
      if (place) handleSelect(place);
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const showClear = query.length > 0 && !isLoading;

  return (
    <div ref={containerRef} className="relative">
      {/* Input */}
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 flex items-center text-fg-muted">
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0 && selectedName === null) setIsOpen(true);
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          role="combobox"
          className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 py-0 pl-9 pr-8 text-sm text-fg-primary placeholder:text-fg-muted transition-all duration-150 focus:border-accent-rose focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        />
        {showClear && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 flex items-center text-fg-muted transition-colors hover:text-fg-secondary"
            aria-label="Clear search"
            tabIndex={-1}
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Error */}
      {error && !isOpen && (
        <p className="mt-1.5 text-xs text-accent-red">{error}</p>
      )}

      {/* Dropdown */}
      {isOpen && results.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-sm border border-glass-border bg-bg-secondary shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6)]"
        >
          {results.map((place, i) => (
            <li
              key={place.placeId}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur on input
                handleSelect(place);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors duration-100 ${
                i === activeIndex
                  ? "bg-bg-tertiary/80"
                  : "hover:bg-bg-tertiary/50"
              } ${i > 0 ? "border-t border-glass-border" : ""}`}
            >
              <MapPin
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted"
                strokeWidth={1.5}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg-primary">
                  {place.name}
                </p>
                {place.formattedAddress && (
                  <p className="truncate text-xs text-fg-muted">
                    {place.formattedAddress}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* No results */}
      {isOpen && !isLoading && results.length === 0 && query.length >= MIN_QUERY_LENGTH && (
        <div className="absolute z-50 mt-1 w-full rounded-sm border border-glass-border bg-bg-secondary px-3 py-3 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6)]">
          <p className="text-xs text-fg-muted">No results for &ldquo;{query}&rdquo;</p>
        </div>
      )}
    </div>
  );
}
