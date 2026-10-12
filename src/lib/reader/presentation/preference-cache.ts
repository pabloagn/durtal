import { z } from "zod/v4";
import { deviceClassSchema, presentationSchema, resetReaderPreferencesSchema, updateReaderPreferencesSchema } from "@/lib/validations/reader-preferences";
import { idSchema } from "@/lib/validations/helpers";
import { preferenceAdoptionSchema, type PreferenceScope } from "./preference-plan";
import type { PresentationRow } from "./defaults";

export const MAX_PREFERENCE_STORAGE_CHARS = 64 * 1024;
const rowSchema = z.object({ deviceClass: deviceClassSchema, ebookId: idSchema.nullable(),
  presentation: presentationSchema.partial() }).strict();
const cacheSchema = z.object({ version: z.literal(1), scope: preferenceAdoptionSchema,
  rows: z.array(rowSchema).max(2) }).strict();

export function preferenceCacheKey(input: PreferenceScope): string {
  const scope = preferenceAdoptionSchema.parse(input);
  return `durtal-reader-preference-cache:v1:${scope.deviceClass}:${scope.ebookId ?? "defaults"}`;
}
export function boundedPreferenceJson(raw: string): unknown {
  if (raw.length > MAX_PREFERENCE_STORAGE_CHARS) throw new Error("Reading-settings storage is too large.");
  return JSON.parse(raw);
}
export function boundedPreferenceString(value: unknown): string {
  const raw = JSON.stringify(value);
  if (typeof raw !== "string" || raw.length > MAX_PREFERENCE_STORAGE_CHARS) throw new Error("Reading-settings storage is too large.");
  return raw;
}
export function validateCachedPreferenceRows(input: unknown, expected: PreferenceScope): readonly PresentationRow[] {
  const scope = preferenceAdoptionSchema.parse(expected);
  const rows = z.array(rowSchema).max(2).parse(input);
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.deviceClass !== scope.deviceClass || (row.ebookId !== null && row.ebookId !== scope.ebookId))
      throw new Error("Wrong cached reading-settings scope.");
    const key = row.ebookId ?? "defaults";
    if (keys.has(key)) throw new Error("Duplicate cached reading-settings scope.");
    keys.add(key);
  }
  boundedPreferenceString(rows);
  return Object.freeze(rows.map(row => Object.freeze({ ...row, presentation: Object.freeze({ ...row.presentation }) })));
}
/** Only a same-book/class acknowledged snapshot is reading authority, never a draft. */
export function parsePreferenceCache(raw: string, expected: PreferenceScope): readonly PresentationRow[] {
  const cache = cacheSchema.parse(boundedPreferenceJson(raw));
  const scope = preferenceAdoptionSchema.parse(expected);
  if (cache.scope.deviceClass !== scope.deviceClass || cache.scope.ebookId !== scope.ebookId)
    throw new Error("Wrong cached reading-settings scope.");
  return validateCachedPreferenceRows(cache.rows, scope);
}
export function serializePreferenceCache(scope: PreferenceScope, acknowledged: readonly PresentationRow[]): string {
  const rows = validateCachedPreferenceRows(acknowledged.filter(row => row.deviceClass === scope.deviceClass), scope);
  return boundedPreferenceString({ version: 1, scope: preferenceAdoptionSchema.parse(scope), rows });
}


const draftSchema = z.object({ version: z.literal(1), scope: preferenceAdoptionSchema,
  jobs: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("update"), input: updateReaderPreferencesSchema }).strict(),
    z.object({ kind: z.literal("reset"), input: resetReaderPreferencesSchema }).strict(),
  ])).max(128) }).strict();
const durableDraftSchema = z.object({ version: z.literal(1), owner: idSchema, draft: draftSchema }).strict();
type DraftStorage = Pick<Storage, "getItem" | "setItem">;
export type DraftLock = (operation: () => void) => Promise<void>;
export function preferenceDraftKey(input: PreferenceScope): string {
  const scope = preferenceAdoptionSchema.parse(input);
  return `durtal-reader-preference-durable:v1:${scope.deviceClass}:${scope.ebookId ?? "defaults"}`;
}
function scopedDraft(input: unknown, expected: PreferenceScope) {
  const draft = draftSchema.parse(input);
  if (draft.scope.deviceClass !== expected.deviceClass || draft.scope.ebookId !== expected.ebookId)
    throw new Error("Wrong durable reading-settings draft scope.");
  for (const job of draft.jobs) {
    if (job.input.deviceClass !== expected.deviceClass || (job.input.ebookId !== null && job.input.ebookId.toLowerCase() !== expected.ebookId)
      || ("clearBookOverrideId" in job.input && job.input.clearBookOverrideId !== undefined && job.input.clearBookOverrideId.toLowerCase() !== expected.ebookId))
      throw new Error("Wrong durable reading-settings job scope.");
  }
  return draft;
}
/** The scope lock serializes cross-tab read/compare/write. A new controller may
 * take over its read snapshot, but a late older owner cannot erase that draft.
 * Conflicts stay unsaved and visible; they never overwrite another tab's work.
 */
export function createDurablePreferenceDraft(input: PreferenceScope, storage: DraftStorage,
  lock: DraftLock | undefined, writer: string) {
  const scope = preferenceAdoptionSchema.parse(input), owner = idSchema.parse(writer), key = preferenceDraftKey(scope);
  let expected: string | null | undefined;
  let recovery: unknown;
  try {
    expected = storage.getItem(key);
    if (expected !== null) {
      const value = durableDraftSchema.parse(boundedPreferenceJson(expected));
      recovery = scopedDraft(value.draft, scope);
    }
  } catch { recovery = { unavailable: true }; }
  let queue: Promise<void> = Promise.resolve();
  function commit(operation: () => void): Promise<void> {
    const exclusive = async () => {
      if (!lock || expected === undefined) throw new Error("Durable reading-settings storage is unavailable.");
      await lock(() => {
        if (storage.getItem(key) !== expected)
          throw new Error("Reading settings changed in another tab. Keep this tab open; its unsaved edits have not replaced the other draft.");
        operation();
      });
    };
    const result = queue.then(exclusive, exclusive);
    queue = result.catch(() => {});
    return result;
  }
  return {
    recovery,
    persist(draft: unknown | null): Promise<void> {
      // Keep an owned empty authority so a stale session copy cannot resurrect jobs.
      const next = boundedPreferenceString({ version: 1, owner,
        draft: scopedDraft(draft ?? { version: 1, scope, jobs: [] }, scope) });
      return commit(() => { storage.setItem(key, next); expected = next; });
    },
    persistAcknowledged(rows: readonly PresentationRow[]): Promise<void> {
      const cached = serializePreferenceCache(scope, rows);
      return commit(() => {
        // Adoption without pending edits must also claim this scope. Preserve the
        // latest durable jobs; acknowledgement of a job is a separate saver step.
        const draft = expected === null ? { version: 1, scope, jobs: [] }
          : scopedDraft(durableDraftSchema.parse(boundedPreferenceJson(expected!)).draft, scope);
        const owned = boundedPreferenceString({ version: 1, owner, draft });
        if (owned !== expected) { storage.setItem(key, owned); expected = owned; }
        // The comparison and both mutations share the same cross-tab scope lock.
        // A failed cache write leaves the pending draft intact and reports failure.
        storage.setItem(preferenceCacheKey(scope), cached);
      });
    },
  };
}
