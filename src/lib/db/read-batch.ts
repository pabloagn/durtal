import type { SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";

interface Waiting {
  query: SQL;
  resolve: (rows: unknown[]) => void;
  reject: (error: unknown) => void;
}

let waiting: Waiting[] = [];

/**
 * A read query's rows, sent together with the reads started alongside it.
 *
 * Every query started in the same turn of the event loop (the reads of one
 * `Promise.all`) joins one batch, which the Neon HTTP driver sends as one
 * request (`db.batch`, one read-only transaction) instead of one request
 * each. The rows come back exactly as `db.execute` gives them: the same
 * queries, parsed by the same driver. A page of many parallel reads (the
 * reading stats, about 22 of them) then costs one round trip and one
 * connection instead of 22.
 *
 * One failing query fails its whole batch. A driver without `batch` (a local
 * Postgres in a script) runs each query on its own.
 */
export function batchedRows<T>(query: SQL): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    if (waiting.length === 0) queueMicrotask(flush);
    waiting.push({ query, resolve: resolve as (rows: unknown[]) => void, reject });
  });
}

async function flush() {
  const batch = waiting;
  waiting = [];
  const conn = db as unknown as { batch?: (queries: unknown[]) => Promise<unknown[]> };
  if (batch.length === 1 || typeof conn.batch !== "function") {
    for (const item of batch) db.execute(item.query).then((result) => item.resolve(resultRows(result)), item.reject);
    return;
  }
  try {
    const results = await conn.batch(batch.map((item) => db.execute(item.query)));
    results.forEach((result, i) => batch[i].resolve(resultRows(result)));
  } catch (error) {
    for (const item of batch) item.reject(error);
  }
}
