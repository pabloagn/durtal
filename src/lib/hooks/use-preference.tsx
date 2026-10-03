"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { deleteCookie, readCookie, writeCookie } from "@/lib/utils/preference-cookies";

const PREFERENCE_EVENT = "durtal-preference";

/** The preference cookies of the request, so the server renders saved values. */
const PreferencesContext = createContext<Record<string, string>>({});

export function PreferencesProvider({
  initial,
  children,
}: {
  initial: Record<string, string>;
  children: React.ReactNode;
}) {
  return (
    <PreferencesContext.Provider value={initial}>
      {children}
    </PreferencesContext.Provider>
  );
}

function subscribe(onChange: () => void) {
  window.addEventListener(PREFERENCE_EVENT, onChange);
  return () => window.removeEventListener(PREFERENCE_EVENT, onChange);
}

// One parsed value per raw string, so a render gets the same object each time
const parsed = new Map<string, unknown>();

function parse<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined) return fallback;
  if (!parsed.has(raw)) {
    try {
      parsed.set(raw, JSON.parse(raw));
    } catch {
      parsed.set(raw, undefined);
    }
  }
  return (parsed.get(raw) as T | undefined) ?? fallback;
}

/**
 * A UI preference kept in a cookie. The server renders the saved value, so
 * the page does not change after it loads. Instances with the same key stay
 * in sync.
 */
export function usePreference<T>(key: string, fallback: T) {
  const serverCookies = useContext(PreferencesContext);
  const raw = useSyncExternalStore(
    subscribe,
    () => readCookie(key),
    () => serverCookies[key],
  );
  const value = parse(raw, fallback);
  // Latest value, so setValue can resolve updater functions
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Older builds kept preferences in localStorage: move each one to its cookie once
  useEffect(() => {
    try {
      const legacy = localStorage.getItem(key);
      if (legacy === null) return;
      localStorage.removeItem(key);
      if (readCookie(key) !== undefined) return;
      writeCookie(key, legacy);
      window.dispatchEvent(new Event(PREFERENCE_EVENT));
    } catch {
      // ignore
    }
  }, [key]);

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      const resolved = next instanceof Function ? next(valueRef.current) : next;
      valueRef.current = resolved;
      writeCookie(key, JSON.stringify(resolved));
      window.dispatchEvent(new Event(PREFERENCE_EVENT));
    },
    [key],
  );

  return [value, setValue] as const;
}

/**
 * Delete saved preferences (their cookies): every instance shows its
 * fallback again. Browser only.
 */
export function clearPreferences(keys: string[]) {
  for (const key of keys) deleteCookie(key);
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

/**
 * A saved view mode that this page offers. A value the page does not offer
 * (an older build's, or another page's) gives the fallback instead.
 */
export function useViewModePreference<T extends string>(
  key: string,
  modes: readonly T[],
  fallback: T,
) {
  const [value, setValue] = usePreference<T>(key, fallback);
  return [modes.includes(value) ? value : fallback, setValue] as const;
}
