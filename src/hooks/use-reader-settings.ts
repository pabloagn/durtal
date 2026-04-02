"use client";

import { useState, useCallback, useEffect } from "react";
import {
  type ReaderThemeSettings,
  READER_DEFAULTS,
} from "@/components/reader/epub-theme";

const STORAGE_KEY = "durtal-reader-settings";

function loadSettings(): ReaderThemeSettings {
  if (typeof window === "undefined") return READER_DEFAULTS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...READER_DEFAULTS, ...JSON.parse(stored) };
    }
  } catch {}
  return READER_DEFAULTS;
}

export function useReaderSettings() {
  const [settings, setSettingsState] =
    useState<ReaderThemeSettings>(READER_DEFAULTS);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setSettingsState(loadSettings());
    setInitialized(true);
  }, []);

  const setSettings = useCallback(
    (update: Partial<ReaderThemeSettings>) => {
      setSettingsState((prev) => {
        const next = { ...prev, ...update };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const resetSettings = useCallback(() => {
    setSettingsState(READER_DEFAULTS);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { settings, setSettings, resetSettings, initialized };
}
