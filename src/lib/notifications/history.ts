/**
 * The notification history: completed notifications this browser showed,
 * newest first, each read or unread. All completed notifications stay
 * until explicitly removed. It lives in this browser's storage, so it survives
 * navigation, the reader and a reload, and follows other open tabs. A storage
 * that refuses (a private window) keeps it for the page's life only.
 */

import { localNotificationLink, type NotificationLink } from "./content";

export type NotificationKind = "error" | "warning" | "success" | "info";

export interface NotificationEntry {
  /** Stable across updates of the same toast */
  id: string;
  kind: NotificationKind;
  title: string;
  description: string | null;
  /** When it last arrived (ms) */
  at: number;
  /** How many times it arrived in a row */
  count: number;
  read: boolean;
  link?: NotificationLink;
}

export const STORAGE_KEY = "durtal-notifications";
/** The same message again within this window counts once more, as one entry */
export const REPEAT_MS = 60 * 1000;

let entries: NotificationEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function isEntry(value: unknown): value is NotificationEntry {
  const e = value as NotificationEntry;
  return !!e && typeof e.id === "string" && ["error", "warning", "success", "info"].includes(e.kind) &&
    typeof e.title === "string" && (e.description === null || typeof e.description === "string") &&
    typeof e.at === "number" && typeof e.count === "number" && typeof e.read === "boolean";
}

function read(): NotificationEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry).map((entry) => ({ ...entry, link: localNotificationLink(entry.link) })) : [];
  } catch {
    return [];
  }
}

/** Another tab changed the history */
function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  entries = read();
  emit();
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  entries = read();
  window.addEventListener("storage", onStorage);
}

function emit() {
  for (const listener of listeners) listener();
}

function commit(next: NotificationEntry[]) {
  entries = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Kept for this page only
  }
  emit();
}

export function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEntries(): NotificationEntry[] {
  load();
  return entries;
}

const NONE: NotificationEntry[] = [];
export function getServerEntries(): NotificationEntry[] {
  return NONE;
}

/**
 * Keep a notification, once per time it is shown. The same toast updated (a
 * pending one that failed) changes its entry; the same toast shown again with
 * the same words, or the same message again soon after the newest entry,
 * counts once more on that entry, unread and at the top (SLN-1460).
 */
export function record(
  input: { id: string; kind: NotificationKind; title: string; description?: string | null; link?: NotificationLink },
  now = Date.now(),
) {
  load();
  const description = input.description ?? null;
  input = { ...input, link: localNotificationLink(input.link) };
  const same = entries.find((e) => e.id === input.id);
  if (same) {
    if (same.kind === input.kind && same.title === input.title && same.description === description && same.link?.href === input.link?.href) {
      commit([{ ...same, at: now, count: same.count + 1, read: false }, ...entries.filter((e) => e !== same)]);
      return;
    }
    commit([{ ...same, ...input, description, at: now, read: false }, ...entries.filter((e) => e !== same)]);
    return;
  }
  const latest = entries[0];
  if (latest && latest.kind === input.kind && latest.title === input.title &&
      latest.description === description && latest.link?.href === input.link?.href && now - latest.at < REPEAT_MS) {
    commit([{ ...latest, at: now, count: latest.count + 1, read: false }, ...entries.slice(1)]);
    return;
  }
  commit([{ ...input, description, at: now, count: 1, read: false }, ...entries]);
}

/** Mark the given entries read; other entries keep their state */
export function markRead(ids: readonly string[]) {
  const set = new Set(ids);
  if (!entries.some((e) => set.has(e.id) && !e.read)) return;
  commit(entries.map((e) => (set.has(e.id) && !e.read ? { ...e, read: true } : e)));
}

export function remove(id: string) {
  commit(entries.filter((e) => e.id !== id));
}

export function clearAll() {
  commit([]);
}

/** For tests: forget the in-memory copy so the next read loads storage again */
export function resetForTests() {
  if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  entries = [];
  loaded = false;
  listeners.clear();
}
