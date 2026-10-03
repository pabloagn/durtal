"use client";

import { useCallback, useMemo } from "react";
import {
  type ReaderThemeSettings,
  READER_DEFAULTS,
  readerSettings,
} from "@/components/reader/epub-theme";
import { usePreference } from "@/lib/hooks/use-preference";
import { READER_SETTINGS_KEY } from "@/lib/preferences";

/**
 * The reader's typography: a cookie, so the server renders the saved
 * settings and the reader panel and Settings → Reader stay in sync.
 */
export function useReaderSettings() {
  const [stored, setStored] = usePreference<unknown>(READER_SETTINGS_KEY, READER_DEFAULTS);
  const settings = useMemo(() => readerSettings(stored), [stored]);

  const setSettings = useCallback(
    (update: Partial<ReaderThemeSettings>) =>
      setStored((current: unknown) => ({ ...readerSettings(current), ...update })),
    [setStored],
  );

  const resetSettings = useCallback(() => setStored(READER_DEFAULTS), [setStored]);

  return { settings, setSettings, resetSettings };
}
