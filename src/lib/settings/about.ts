import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { databaseErrorCode } from "@/lib/db/errors";
import journal from "@/lib/db/migrations/meta/_journal.json";

/** The state of the database schema (Settings, About). Server only. */

export interface MigrationState {
  /** Migrations in this build */
  known: number;
  /** The newest migration the database has run, by name, or null */
  latest: string | null;
  /** Migrations in this build that the database has not run, by name */
  pending: string[];
}

/**
 * Drizzle runs a migration when its journal time is newer than the newest
 * one recorded in drizzle.__drizzle_migrations; the counts do not match on
 * this database (0000 and 0001 were never recorded), so compare times.
 */
export async function migrationState(): Promise<MigrationState> {
  const entries = journal.entries;
  let last: number | null = null;
  try {
    const result = await db.execute(
      sql`select max(created_at)::text as last from drizzle.__drizzle_migrations`,
    );
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
      last: string | null;
    }[];
    last = rows[0]?.last ? Number(rows[0].last) : null;
  } catch (error) {
    // No journal table: nothing has run through drizzle
    if (databaseErrorCode(error) !== "42P01") throw error;
  }
  const applied = last === null ? [] : entries.filter((entry) => entry.when <= last!);
  return {
    known: entries.length,
    latest: applied.at(-1)?.tag ?? null,
    pending: entries.filter((entry) => last === null || entry.when > last).map((e) => e.tag),
  };
}
