import { and, eq, isNull, or, sql } from "drizzle-orm";
import { readerPreferences } from "@/lib/db/schema/reader-preferences";
import { databaseErrorCode, readableDatabaseError } from "@/lib/db/errors";
import type { PreferenceScope } from "./preference-plan";

export const PREFERENCE_STALE_SNAPSHOT = "Reader preference snapshot changed; retry (SLN-501).";
export const PREFERENCE_BOOK_GONE = "This eBook is no longer available.";

export function preferenceScopeWhere(scope: PreferenceScope) {
  return and(eq(readerPreferences.deviceClass, scope.deviceClass),
    scope.ebookId === null ? isNull(readerPreferences.ebookId)
      : or(isNull(readerPreferences.ebookId), eq(readerPreferences.ebookId, scope.ebookId)));
}

/** Include row identities, complete JSON and timestamp microseconds; [] also guards absence. */
function snapshotExpression(scope: PreferenceScope) {
  return sql`(select coalesce(jsonb_agg(jsonb_build_object(
    'id', ${readerPreferences.id}, 'deviceClass', ${readerPreferences.deviceClass},
    'ebookId', ${readerPreferences.ebookId}, 'presentation', ${readerPreferences.presentation},
    'updatedAt', to_char(${readerPreferences.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  ) order by ${readerPreferences.ebookId} nulls first), '[]'::jsonb)
  from ${readerPreferences} where ${preferenceScopeWhere(scope)})`;
}

export function preferenceSnapshotSQL(scope: PreferenceScope) {
  // Keep canonical JSON text intact: unknown future JSON numbers must not round in JS.
  return sql`select ${snapshotExpression(scope)}::text as snapshot`;
}

/** This must be a distinct statement before the guard, so a waited lock gets a fresh snapshot. */
export function preferenceClassLockSQL(scope: PreferenceScope) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${'reader-preferences:' + scope.deviceClass}, 0))`;
}

export function preferenceSnapshotGuardSQL(scope: PreferenceScope, expected: unknown) {
  const canonical = typeof expected === "string" ? expected : JSON.stringify(expected);
  return sql`select harmonization_assert(${snapshotExpression(scope)} = ${canonical}::jsonb, ${PREFERENCE_STALE_SNAPSHOT})`;
}

export function preferenceBookGuardSQL(ebookId: string) {
  return sql`select harmonization_assert(exists(select 1 from ebooks where id = ${ebookId}::uuid for key share), ${PREFERENCE_BOOK_GONE})`;
}

export function isPreferenceSnapshotConflict(error: unknown): boolean {
  if (databaseErrorCode(error) !== "P0001") return false;
  const readable = readableDatabaseError(error);
  return readable instanceof Error && readable.message === PREFERENCE_STALE_SNAPSHOT;
}
