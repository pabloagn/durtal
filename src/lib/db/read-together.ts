import { db } from "@/lib/db";

type Db = typeof db;

interface BatchCapable {
  batch?: (queries: readonly unknown[]) => Promise<unknown[]>;
}

/**
 * Reads sent in one round trip: one request through `db.batch` where the
 * driver has it (Neon HTTP), else side by side. Unlike `atomic`, they are not
 * a unit of work, so a driver without `batch` (a local Postgres in tests) runs
 * them in parallel rather than in a transaction.
 *
 * `build` receives the connection to build the queries on; do not await them.
 */
export async function readTogether<T extends readonly unknown[]>(
  build: (d: Db) => T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const queries = build(db);
  const conn = db as unknown as BatchCapable;
  // Neon rejects an empty batch
  const results =
    typeof conn.batch === "function" && queries.length > 0
      ? await conn.batch(queries)
      : await Promise.all(queries);
  return results as { -readonly [K in keyof T]: Awaited<T[K]> };
}
