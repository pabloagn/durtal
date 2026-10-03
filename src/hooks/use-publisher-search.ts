"use client";

import { useEffect, useState } from "react";
import { searchPublisherOptions } from "@/lib/actions/publishers";
import type { PublisherOption } from "@/components/publishers/publisher-picker";

/**
 * Debounced server-side publisher search for publisher pickers: names and
 * aliases, accent-insensitive and typo-tolerant. Nothing is preloaded. A blank
 * query returns no results. Answers to an older query never replace a newer
 * one. `kinds` limits the results to houses or imprints.
 */
export function usePublisherSearch(
  query: string,
  kinds?: ("group" | "publisher" | "imprint")[],
  delayMs = 200,
) {
  const [results, setResults] = useState<PublisherOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const kindKey = kinds?.join(",") ?? "";

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
        const rows = await searchPublisherOptions(
          trimmed,
          kindKey
            ? (kindKey.split(",") as ("group" | "publisher" | "imprint")[])
            : undefined,
        );
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
  }, [query, kindKey, delayMs]);

  return { results, isSearching };
}
