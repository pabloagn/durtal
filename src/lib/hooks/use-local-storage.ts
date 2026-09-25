"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const LOCAL_STORAGE_EVENT = "durtal-local-storage";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);
  // Latest value, so setValue can resolve updater functions without running
  // side effects inside a React state updater (updaters run during render).
  const valueRef = useRef<T>(initialValue);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        const parsed = JSON.parse(item) as T;
        valueRef.current = parsed;
        setStoredValue(parsed);
      }
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
        if (item) {
          const parsed = JSON.parse(item) as T;
          valueRef.current = parsed;
          setStoredValue(parsed);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener(LOCAL_STORAGE_EVENT, handler);
    return () => window.removeEventListener(LOCAL_STORAGE_EVENT, handler);
  }, [key]);

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      const next = value instanceof Function ? value(valueRef.current) : value;
      valueRef.current = next;
      setStoredValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
        // Notify other instances with the same key (outside of render)
        window.dispatchEvent(
          new CustomEvent(LOCAL_STORAGE_EVENT, { detail: { key } }),
        );
      } catch {
        // ignore
      }
    },
    [key],
  );

  return [storedValue, setValue, isHydrated] as const;
}
