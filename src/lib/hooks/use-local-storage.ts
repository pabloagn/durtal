"use client";

import { useState, useEffect, useCallback } from "react";

const LOCAL_STORAGE_EVENT = "durtal-local-storage";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) setStoredValue(JSON.parse(item));
    } catch {
      // ignore
    }
    setIsHydrated(true);
  }, [key]);

  // Sync across hook instances in the same tab
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key !== key) return;
      try {
        const item = window.localStorage.getItem(key);
        if (item) setStoredValue(JSON.parse(item));
      } catch {
        // ignore
      }
    };
    window.addEventListener(LOCAL_STORAGE_EVENT, handler);
    return () => window.removeEventListener(LOCAL_STORAGE_EVENT, handler);
  }, [key]);

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      setStoredValue((prev) => {
        const next = value instanceof Function ? value(prev) : value;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
          window.dispatchEvent(
            new CustomEvent(LOCAL_STORAGE_EVENT, { detail: { key } }),
          );
        } catch {
          // ignore
        }
        return next;
      });
    },
    [key],
  );

  return [storedValue, setValue, isHydrated] as const;
}
