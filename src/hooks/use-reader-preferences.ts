"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { adoptLegacyReaderSettings, resetReaderPreferences, updateReaderPreferences } from "@/lib/actions/reader-preferences";
import { READER_SETTINGS_KEY } from "@/lib/preferences";
import { deleteCookie } from "@/lib/utils/preference-cookies";
import { createPreferenceSaver, type PreferenceSaver } from "@/lib/reader/presentation/preference-saver";
import { preferenceAdoptionSchema, type PreferenceScope } from "@/lib/reader/presentation/preference-plan";
import type { PresentationRow } from "@/lib/reader/presentation/defaults";

type Entry = { saver: PreferenceSaver; mounts: number };
// A remount/BFCache return reuses the same in-flight controller, avoiding stale draft deletion.
const browserEntries = new Map<string, Entry>();

function entryFor(scope: PreferenceScope, rows: readonly PresentationRow[], key: string): Entry {
  const inBrowser = typeof window !== "undefined";
  const existing = inBrowser ? browserEntries.get(key) : undefined;
  if (existing) return existing;
  let recovery: unknown;
  if (inBrowser) {
    try {
      const value = window.sessionStorage.getItem(key);
      recovery = value === null ? undefined : JSON.parse(value);
    } catch { recovery = { unavailable: true }; }
  }
  const entry = { mounts: 0, saver: createPreferenceSaver({
    scope, initialRows: rows, recovery,
    transport: { update: updateReaderPreferences, reset: resetReaderPreferences, adopt: adoptLegacyReaderSettings },
    onAdopted: inBrowser ? () => deleteCookie(READER_SETTINGS_KEY) : undefined,
    persistRecovery: inBrowser ? (draft) => {
      if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft));
      else window.sessionStorage.removeItem(key);
    } : undefined,
  }) };
  if (inBrowser) browserEntries.set(key, entry);
  return entry;
}

/** Caller fixes device class once per open; this hook never redetects on resize. */
export function useReaderPreferences(options: PreferenceScope & { initialRows: readonly PresentationRow[] }) {
  const scope = preferenceAdoptionSchema.parse({ deviceClass: options.deviceClass, ebookId: options.ebookId });
  const key = `durtal-reader-preference-draft:v1:${scope.deviceClass}:${scope.ebookId ?? "defaults"}`;
  const [seed, setSeed] = useState({ key, rows: options.initialRows });
  if (seed.key !== key) setSeed({ key, rows: options.initialRows });
  const initialRows = seed.key === key ? seed.rows : options.initialRows;
  const { deviceClass, ebookId } = scope;
  const entry = useMemo(() => entryFor({ deviceClass, ebookId }, initialRows, key), [deviceClass, ebookId, initialRows, key]);
  const saver = entry.saver;
  const serverSnapshot = useMemo(() => createPreferenceSaver({
    scope: { deviceClass, ebookId }, initialRows,
    transport: { update: updateReaderPreferences, reset: resetReaderPreferences, adopt: adoptLegacyReaderSettings },
  }).getSnapshot(), [deviceClass, ebookId, initialRows]);
  const state = useSyncExternalStore(saver.subscribe, saver.getSnapshot, () => serverSnapshot);

  useEffect(() => {
    entry.mounts++;
    void saver.start();
    const online = () => { void saver.flush(); };
    const pagehide = () => { void saver.flush(); };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) void saver.flush(); };
    window.addEventListener("online", online);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      entry.mounts--;
      if (entry.mounts === 0) void saver.flush().finally(() => {
        const last = saver.getSnapshot();
        if (entry.mounts === 0 && last.pending === 0 && !last.saving && browserEntries.get(key) === entry) browserEntries.delete(key);
      });
    };
  }, [entry, saver, key]);

  return { ...state, update: saver.update, reset: saver.reset, flush: saver.flush };
}
