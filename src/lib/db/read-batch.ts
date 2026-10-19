import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";

interface Waiting {
  query: SQL;
  noJit: boolean;
  resolve: (rows: unknown[]) => void;
  reject: (error: unknown) => void;
}

let waiting: Waiting[] = [];

/** The most reads one request carries before the wave is split */
const PER_REQUEST = 8;

/**
 * A read query's rows, sent together with the reads started alongside it.
 *
 * Every query started in the same turn of the event loop (the reads of one
 * `Promise.all`) joins a batch, which the Neon HTTP driver sends as one
 * request (`db.batch`, one transaction) instead of one request each. The
 * rows come back exactly as `db.execute` gives them: the same queries, parsed
 * by the same driver.
 *
 * A batch runs its queries one after another, so a wave of more than
 * `PER_REQUEST` reads goes out as a few batches side by side, of even size:
 * the reading stats' 31 reads are 4 requests of 7 or 8, each one round trip.
 * One request of 31 waited for all of them in series and was slower than
 * 31 parallel requests until a round trip took about 100 ms.
 *
 * `jit: false` sends the request with `set local jit = off` at its head
 * (SLN-1309), for reads whose planned cost passes `jit_above_cost` but which
 * run in milliseconds: the compile would take seconds. It holds for that one
 * transaction, and for any read sharing it.
 *
 * One failing query fails its batch. A driver without `batch` (a local
 * Postgres in a script) runs each query on its own, with JIT as it is.
 */
export function batchedRows<T>(query: SQL, options: { jit?: boolean } = {}): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    if (waiting.length === 0) queueMicrotask(flush);
    waiting.push({ query, noJit: options.jit === false, resolve: resolve as (rows: unknown[]) => void, reject });
  });
}

function flush() {
  const wave = waiting;
  waiting = [];
  const conn = db as unknown as { batch?: (queries: unknown[]) => Promise<unknown[]> };
  if (typeof conn.batch !== "function" || (wave.length === 1 && !wave[0].noJit)) {
    for (const item of wave) db.execute(item.query).then((result) => item.resolve(resultRows(result)), item.reject);
    return;
  }
  const size = Math.ceil(wave.length / Math.ceil(wave.length / PER_REQUEST));
  for (let start = 0; start < wave.length; start += size) void send(conn.batch.bind(conn), wave.slice(start, start + size));
}

async function send(batch: (queries: unknown[]) => Promise<unknown[]>, items: Waiting[]) {
  try {
    const noJit = items.some((item) => item.noJit);
    const queries = items.map((item) => db.execute(item.query));
    const results = await batch(noJit ? [db.execute(sql`set local jit = off`), ...queries] : queries);
    results.slice(noJit ? 1 : 0).forEach((result, i) => items[i].resolve(resultRows(result)));
  } catch (error) {
    for (const item of items) item.reject(error);
  }
}
