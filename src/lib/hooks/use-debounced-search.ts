"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchResult } from "@/lib/api/types";

export function useDebouncedSearch(delayMs = 300) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const timer = setTimeout(async () => {
      // Abort previous in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const isIsbn = /^\d{10,13}$/.test(query.replace(/[-\s]/g, ""));
        const param = isIsbn
          ? `isbn=${query.replace(/[-\s]/g, "")}`
          : `q=${encodeURIComponent(query.trim())}`;
        const res = await fetch(`/api/search?${param}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        if (!controller.signal.aborted) {
          setResults(data.results ?? []);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [query, delayMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
  }, []);

  return { query, setQuery, results, isSearching, clearResults };
}
