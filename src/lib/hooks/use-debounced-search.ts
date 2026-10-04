"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchResult } from "@/lib/api/types";

export function useDebouncedSearch(delayMs = 300) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  /** What the server says about the sources: "Google Books is over its quota…" */
  const [notices, setNotices] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setNotices([]);
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
          setNotices(data.notices ?? []);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setResults([]);
          setNotices([]);
        }
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
    setNotices([]);
  }, []);

  return { query, setQuery, results, notices, isSearching, clearResults };
}
