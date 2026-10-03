"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Load data for a view only while that view is shown (map, timeline).
 * `key` identifies the inputs (search and filters): a new key loads again,
 * a key loaded before is served from memory. Returns null while loading.
 */
export function useViewData<T>(
  enabled: boolean,
  key: string,
  load: () => Promise<T>,
): T | null {
  const cache = useRef(new Map<string, T>());
  const [, setLoadedKey] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled || cache.current.has(key)) return;
    let current = true;
    loadRef.current().then((data) => {
      cache.current.set(key, data);
      if (current) setLoadedKey(key);
    }, (err) => console.error(err));
    return () => {
      current = false;
    };
  }, [enabled, key]);

  return enabled ? (cache.current.get(key) ?? null) : null;
}
