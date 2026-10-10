"use server";

import { cookies } from "next/headers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { readerPreferences } from "@/lib/db/schema/reader-preferences";
import { READER_SETTINGS_KEY } from "@/lib/preferences";
import {
  getReaderBookOverrides,
  getReaderPreferences,
  preferenceErrorMessage,
  readerPreferenceBookExists,
  readerPreferenceRowsQuery,
} from "@/lib/ebooks/preferences";
import { fromLegacyReaderSettings } from "@/lib/reader/presentation/legacy";
import {
  parsePreferenceReset,
  parsePreferenceUpdate,
  planPreferenceReset,
  planPreferenceUpdate,
  preferenceAdoptionSchema,
  scopedPreferenceRows,
  type PreferenceChange,
  type PreferenceReply,
  type PreferenceScope,
} from "@/lib/reader/presentation/preference-plan";
import {
  isPreferenceSnapshotConflict,
  PREFERENCE_BOOK_GONE,
  preferenceBookGuardSQL,
  preferenceClassLockSQL,
  preferenceSnapshotGuardSQL,
  preferenceSnapshotSQL,
} from "@/lib/reader/presentation/preference-sql";
import type { PresentationRow } from "@/lib/reader/presentation/defaults";

/** Both Neon HTTP results and postgres-js's transaction result arrays. */
function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as T[];
  throw new Error("Invalid preference database response.");
}

function writeQueries(on: typeof db, changes: readonly PreferenceChange[], insertOnly: boolean) {
  return changes.map((change) => {
    const where = and(eq(readerPreferences.deviceClass, change.scope.deviceClass),
      change.scope.ebookId === null ? isNull(readerPreferences.ebookId) : eq(readerPreferences.ebookId, change.scope.ebookId));
    if (change.presentation === null) return on.delete(readerPreferences).where(where);
    const insert = on.insert(readerPreferences).values({ ...change.scope, presentation: { ...change.presentation } });
    const target = [readerPreferences.deviceClass, readerPreferences.ebookId];
    return insertOnly ? insert.onConflictDoNothing({ target }) : insert.onConflictDoUpdate({
      target, set: { presentation: { ...change.presentation }, updatedAt: sql`now()` },
    });
  });
}

/** All writers share the class lock and fresh, separate full-snapshot guard. */
async function mutate(scope: PreferenceScope, plan: (rows: readonly PresentationRow[]) => readonly PreferenceChange[], insertOnly = false): Promise<PreferenceReply> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (scope.ebookId !== null && !await readerPreferenceBookExists(scope.ebookId)) return { ok: false, error: PREFERENCE_BOOK_GONE };
      const [record] = resultRows<{ snapshot: unknown }>(await db.execute(preferenceSnapshotSQL(scope)));
      const canonicalSnapshot = record?.snapshot;
      const snapshot = typeof canonicalSnapshot === "string" ? JSON.parse(canonicalSnapshot) : canonicalSnapshot;
      if (!Array.isArray(snapshot)) throw new Error("Invalid preference snapshot.");
      const changes = plan(snapshot as PresentationRow[]);
      try {
        const results = await atomic((on) => [
          on.execute(preferenceClassLockSQL(scope)),
          ...(scope.ebookId === null ? [] : [on.execute(preferenceBookGuardSQL(scope.ebookId))]),
          on.execute(preferenceSnapshotGuardSQL(scope, canonicalSnapshot)),
          ...writeQueries(on, changes, insertOnly),
          readerPreferenceRowsQuery(on, scope.ebookId),
        ]);
        const rows = resultRows<PresentationRow>(results[results.length - 1]);
        return { ok: true, ...scope, rows: scopedPreferenceRows(rows, scope.ebookId) };
      } catch (error) {
        if (!isPreferenceSnapshotConflict(error)) throw error;
        if (attempt === 2) return { ok: false, error: "Another device is changing these reading settings. Try again." };
      }
    }
    return { ok: false, error: "Reading settings could not be saved." };
  } catch (error) {
    return { ok: false, error: preferenceErrorMessage(error) };
  }
}

export async function updateReaderPreferences(input: unknown): Promise<PreferenceReply> {
  try {
    const value = parsePreferenceUpdate(input);
    const scope = { deviceClass: value.deviceClass, ebookId: value.ebookId ?? value.clearBookOverrideId ?? null };
    return await mutate(scope, (rows) => planPreferenceUpdate(rows, value));
  } catch (error) {
    return { ok: false, error: preferenceErrorMessage(error) };
  }
}

export async function resetReaderPreferences(input: unknown): Promise<PreferenceReply> {
  try {
    const scope = parsePreferenceReset(input);
    return await mutate(scope, () => planPreferenceReset(scope));
  } catch (error) {
    return { ok: false, error: preferenceErrorMessage(error) };
  }
}

function parseCookie(value: string): unknown {
  try { return JSON.parse(value); } catch {
    try { return JSON.parse(decodeURIComponent(value)); } catch { return null; }
  }
}

/** Never accept legacy data from the client. Existing defaults, including reset, win. */
export async function adoptLegacyReaderSettings(input: unknown): Promise<PreferenceReply> {
  try {
    const scope = preferenceAdoptionSchema.parse(input);
    const legacy = (await cookies()).get(READER_SETTINGS_KEY)?.value;
    if (legacy === undefined) {
      const result = await getReaderPreferences(scope.ebookId);
      return result.ok ? { ok: true, ...scope, rows: result.rows } : result;
    }
    const presentation = fromLegacyReaderSettings(parseCookie(legacy), scope.deviceClass);
    return await mutate(scope, (rows) => rows.some((row) => row.deviceClass === scope.deviceClass && row.ebookId === null)
      ? [] : [{ scope: { deviceClass: scope.deviceClass, ebookId: null }, presentation }], true);
  } catch (error) {
    return { ok: false, error: preferenceErrorMessage(error) };
  }
}

export async function listReaderBookOverrides(input: unknown) {
  return getReaderBookOverrides(input);
}
