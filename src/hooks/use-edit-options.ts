"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getEditOptions } from "@/lib/actions/edit-options";
import type { EditOption, EditOptionGroup, EditOptions } from "@/lib/catalogue/edit-options";

/*
 * The edit dialogs' choices (SLN-510), loaded when a dialog opens and shared
 * by every dialog: one request for the lists not loaded yet, kept while the
 * tab stays in the app and checked again on an open a minute later.
 */

const FRESH_MS = 60_000;
const cache = new Map<EditOptionGroup, { list: EditOption[]; at: number }>();
const inflight = new Map<EditOptionGroup, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Loads the lists that are missing or a minute old; one request for them all */
function ensure(groups: readonly EditOptionGroup[]): Promise<void> {
  const now = Date.now();
  const missing = groups.filter((g) => !inflight.has(g) && (!cache.has(g) || now - cache.get(g)!.at > FRESH_MS));
  if (missing.length) {
    const request = getEditOptions([...missing]).then((lists) => {
      for (const g of missing) cache.set(g, { list: lists[g] ?? [], at: Date.now() });
      notify();
    });
    const settled = request.finally(() => {
      for (const g of missing) inflight.delete(g);
    });
    for (const g of missing) inflight.set(g, settled);
  }
  return Promise.all(groups.map((g) => inflight.get(g)).filter(Boolean)).then(() => undefined);
}

/** Starts these lists on a sign that their dialog will open; a failure is the dialog's to show */
export function preloadEditOptions(groups: readonly EditOptionGroup[]) {
  ensure(groups).catch(() => undefined);
}

/**
 * These lists for a dialog: what is loaded so far (an older copy stays while
 * a fresh one loads), whether they are still on their way, whether the load
 * failed, and `load` to start (or retry) it. Call `load` when the dialog opens.
 */
export function useEditOptions(groups: readonly EditOptionGroup[], open: boolean) {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const [failed, setFailed] = useState(false);
  const key = groups.join(",");
  const load = useCallback(() => {
    ensure(key.split(",") as EditOptionGroup[]).then(
      () => setFailed(false),
      () => setFailed(true),
    );
  }, [key]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  const options: EditOptions = {};
  for (const g of groups) {
    const hit = cache.get(g);
    if (hit) options[g] = hit.list;
  }
  const loading = !failed && groups.some((g) => !cache.has(g));
  return { options, loading, failed, retry: load };
}
