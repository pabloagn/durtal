"use client";

import { readerUuid } from "@/lib/reader/uuid";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { adoptLegacyReaderSettings, resetReaderPreferences, updateReaderPreferences } from "@/lib/actions/reader-preferences";
import { READER_SETTINGS_KEY } from "@/lib/preferences";
import { deleteCookie } from "@/lib/utils/preference-cookies";
import { createPreferenceSaver, type PreferenceSaver } from "@/lib/reader/presentation/preference-saver";
import { preferenceAdoptionSchema, type PreferenceScope } from "@/lib/reader/presentation/preference-plan";
import type { PresentationRow } from "@/lib/reader/presentation/defaults";
import { boundedPreferenceJson, createDurablePreferenceDraft, parsePreferenceCache, preferenceCacheKey, preferenceDraftKey,
  type DraftLock } from "@/lib/reader/presentation/preference-cache";

type Entry = Readonly<{ saver: PreferenceSaver; activate(): () => void }>;
// A remount/BFCache return reuses the same in-flight controller, avoiding stale draft deletion.
const browserEntries = new Map<string, Entry>();

function entryFor(scope: PreferenceScope, rows: readonly PresentationRow[], key: string, localPreferenceAdmission: boolean): Entry {
  const entryKey = localPreferenceAdmission ? `${key}:downloaded` : key;
  const inBrowser = typeof window !== "undefined";
  const existing = inBrowser ? browserEntries.get(entryKey) : undefined;
  if (existing) return existing;
  let recovery: unknown;
  let cachedRows: readonly PresentationRow[] | undefined;
  let cacheError: string | null = null;
  let persistRecovery: ((draft: unknown | null) => Promise<void>) | undefined;
  let persistAcknowledged: ((rows: readonly PresentationRow[]) => Promise<void>) | undefined;
  if (inBrowser) {
    try {
      const lock: DraftLock | undefined = navigator.locks
        ? operation => navigator.locks.request(preferenceDraftKey(scope), operation) : undefined;
      const durable = createDurablePreferenceDraft(scope, window.localStorage, lock, readerUuid());
      persistAcknowledged = durable.persistAcknowledged;
      recovery = durable.recovery;
      // Read the prior tab-only format only when no durable record exists.
      if (recovery === undefined) {
        const legacy = window.sessionStorage.getItem(key);
        if (legacy !== null) recovery = boundedPreferenceJson(legacy);
      }
      persistRecovery = async draft => {
        await durable.persist(draft);
        // Durable storage is authority. A stale legacy copy must not resurrect an acknowledged job.
        try { window.sessionStorage.removeItem(key); } catch { /* Durable snapshot is already committed. */ }
      };
    } catch {
      recovery = { unavailable: true };
      persistRecovery = async () => { throw new Error("Durable reading-settings storage is unavailable."); };
      persistAcknowledged = async () => { throw new Error("Acknowledged reading-settings storage is unavailable."); };
    }
  }
  if (inBrowser) {
    try {
      const value = window.localStorage.getItem(preferenceCacheKey(scope));
      if (value !== null) cachedRows = parsePreferenceCache(value, scope);
    } catch { cacheError = "Saved reading settings could not be loaded. Safe defaults are available offline."; }
  }
  const saver = createPreferenceSaver({
    scope, initialRows: rows, recovery, cachedRows, cacheError, localPreferenceAdmission,
    online: !inBrowser || navigator.onLine !== false,
    persistAcknowledged,
    transport: { update: updateReaderPreferences, reset: resetReaderPreferences, adopt: adoptLegacyReaderSettings },
    onAdopted: inBrowser ? () => deleteCookie(READER_SETTINGS_KEY) : undefined,
    persistRecovery,
  });
  // Ownership lives in the external controller closure, never a hook-visible mutable value.
  let mounts = 0;
  const entry: Entry = Object.freeze({
    saver,
    activate() {
      mounts++;
      saver.setOnline(navigator.onLine !== false);
      void saver.start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        mounts--;
        if (mounts === 0) {
          saver.pause();
          const last = saver.getSnapshot();
          if (last.pending === 0 && !last.saving && browserEntries.get(entryKey) === entry) browserEntries.delete(entryKey);
        }
      };
    },
  });
  if (inBrowser) browserEntries.set(entryKey, entry);
  return entry;
}

/** Caller fixes device class once per open; this hook never redetects on resize. */
export function useReaderPreferences(options: PreferenceScope & { initialRows: readonly PresentationRow[]; localPreferenceAdmission?: boolean }) {
  const scope = preferenceAdoptionSchema.parse({ deviceClass: options.deviceClass, ebookId: options.ebookId });
  const key = `durtal-reader-preference-draft:v1:${scope.deviceClass}:${scope.ebookId ?? "defaults"}`;
  const [seed, setSeed] = useState({ key, rows: options.initialRows });
  if (seed.key !== key) setSeed({ key, rows: options.initialRows });
  const initialRows = seed.key === key ? seed.rows : options.initialRows;
  const { deviceClass, ebookId } = scope;
  const localPreferenceAdmission = options.localPreferenceAdmission === true;
  const entry = useMemo(() => entryFor({ deviceClass, ebookId }, initialRows, key, localPreferenceAdmission),
    [deviceClass, ebookId, initialRows, key, localPreferenceAdmission]);
  const saver = entry.saver;
  const serverSnapshot = useMemo(() => createPreferenceSaver({
    scope: { deviceClass, ebookId }, initialRows,
    transport: { update: updateReaderPreferences, reset: resetReaderPreferences, adopt: adoptLegacyReaderSettings },
  }).getSnapshot(), [deviceClass, ebookId, initialRows]);
  const state = useSyncExternalStore(saver.subscribe, saver.getSnapshot, () => serverSnapshot);

  useEffect(() => {
    const release = entry.activate();
    const online = () => { saver.setOnline(navigator.onLine !== false); void saver.flush(); };
    const offline = () => { saver.setOnline(false); };
    const pagehide = () => { saver.setOnline(navigator.onLine !== false); void saver.flush(); };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) { saver.setOnline(navigator.onLine !== false); void saver.flush(); }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      release();
    };
  }, [entry, saver, key]);

  return { ...state, update: saver.update, reset: saver.reset, flush: saver.flush };
}
