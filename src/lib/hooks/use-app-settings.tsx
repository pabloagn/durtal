"use client";

import { createContext, useContext } from "react";
import type { AppSettings } from "@/lib/actions/settings";
import { DEFAULT_CURRENCY } from "@/lib/constants/currencies";

const AppSettingsContext = createContext<AppSettings>({
  newBookStatus: "tracked",
  newBookLanguage: "en",
  newCopyLocationId: null,
  newCopyFormat: "paperback",
  newCopyCondition: "mint",
  homeCurrency: DEFAULT_CURRENCY,
  readingDayStartHour: 4,
  readingWeekStart: 1,
  readingTimerCheckMinutes: 90,
  readingRhythmDays: null,
  readingSuggestHideAnathema: false,
  readingPredictionGate: null,
});

/** The app-wide settings, read once per request by the root layout. */
export function AppSettingsProvider({
  settings,
  children,
}: {
  settings: AppSettings;
  children: React.ReactNode;
}) {
  return (
    <AppSettingsContext.Provider value={settings}>{children}</AppSettingsContext.Provider>
  );
}

/** The app-wide settings: defaults for new books, copies and orders. */
export function useAppSettings(): AppSettings {
  return useContext(AppSettingsContext);
}
