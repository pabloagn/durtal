"use client";

import { useEffect, useState } from "react";
import { searchAuthorsLite } from "@/lib/actions/authors";

export interface AuthorOption {
  id: string;
  name: string;
}

/**
 * Debounced server-side author search for author pickers. Every author in
 * the database is searchable; nothing is preloaded. A blank query returns no
 * results. Answers to an older query never replace a newer one.
 */
export function useAuthorSearch(query: string, delayMs = 250) {
  const [results, setResults] = useState<AuthorOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    let stale = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await searchAuthorsLite(trimmed);
        if (!stale) setResults(rows);
      } catch {
        if (!stale) setResults([]);
      } finally {
        if (!stale) setIsSearching(false);
      }
    }, delayMs);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, delayMs]);

  return { results, isSearching };
}
