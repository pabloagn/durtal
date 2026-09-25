import { db } from "@/lib/db";

type Db = typeof db;

interface AtomicCapable {
  batch?: (queries: unknown[]) => Promise<unknown[]>;
  transaction: (run: (tx: Db) => Promise<unknown[]>) => Promise<unknown[]>;
}

/**
 * Run write queries as one unit: all of them succeed or none is applied.
 *
 * The production driver (neon-http) has no interactive transactions, but it
 * runs `db.batch()` as a single transaction. Drivers without `batch` (a local
 * Postgres in tests) run the same queries inside `db.transaction()`.
 *
 * `build` receives the connection to build the queries on; do not await them.
 */
export async function atomic(build: (d: Db) => unknown[]): Promise<unknown[]> {
  const conn = db as unknown as AtomicCapable;
  if (typeof conn.batch === "function") {
    const queries = build(db);
    return queries.length > 0 ? conn.batch(queries) : [];
  }
  return conn.transaction(async (tx) => {
    const results: unknown[] = [];
    for (const query of build(tx)) results.push(await query);
    return results;
  });
}
