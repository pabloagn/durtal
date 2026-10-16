import { is, Param, Placeholder } from "drizzle-orm";
import { PgSelectBase, type AnyPgSelect } from "drizzle-orm/pg-core";
import { PgRelationalQuery } from "drizzle-orm/pg-core/query-builders/query";
import { db } from "@/lib/db";

// Select builders lose methods such as `where` as they are used. Keep only
// their read-specific shape; write builders do not carry this select metadata.
type SelectRead = Pick<AnyPgSelect, "_" | "toSQL" | "then">;
export type ReadQuery = SelectRead | PgRelationalQuery<unknown>;

interface WaitingRead {
  query: ReadQuery;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

type BatchConnection = {
  batch?: (queries: readonly [ReadQuery, ...ReadQuery[]]) => Promise<readonly unknown[]>;
};

const PER_REQUEST = 8;

/**
 * One function/request's ordinary, fully bound read builders. Keep the original
 * builders so each driver's mapper preserves relations, column decoding and
 * findFirst's undefined result. Do not share an instance across requests.
 *
 * A batch is one HTTP transaction; a failure rejects its whole batch. Separate
 * chunks remain independent. With no batch driver (or one read), await each
 * original builder once. Existing raw SQL callers keep using batchedRows.
 */
export function createReadBatch(connection: object = db) {
  let waiting: WaitingRead[] = [];
  const seen = new WeakSet<object>();
  const driver = connection as BatchConnection;

  function validate(query: ReadQuery) {
    if (!is(query, PgSelectBase) && !is(query, PgRelationalQuery))
      throw new Error("Read batching accepts select and relational read builders only");
    const options = query as unknown as {
      authToken?: unknown;
      cacheConfig?: unknown;
      config?: { lockingClause?: unknown; withList?: unknown[] };
    };
    // Pinned Drizzle 0.45.2 exposes these options on its builder objects; the
    // batch path does not preserve their execute() behavior. Fail explicitly.
    if (options.authToken !== undefined || options.cacheConfig !== undefined
      || options.config?.lockingClause || options.config?.withList?.length)
      throw new Error("Read batching excludes auth, cache, locking and CTE options");
    if (query.toSQL().params.some((value) => is(value, Placeholder)
      || (is(value, Param) && is(value.value, Placeholder))))
      throw new Error("Read batching requires fully bound parameters");
    if (seen.has(query)) throw new Error("A read builder may be queued only once");
    seen.add(query);
  }

  async function send(items: WaitingRead[]) {
    try {
      const queries = items.map((item) => item.query) as [ReadQuery, ...ReadQuery[]];
      const results = await driver.batch!.call(connection, queries);
      if (results.length !== items.length) throw new Error("Read batch returned an unexpected result count");
      results.forEach((result, i) => items[i].resolve(result));
    } catch (error) {
      for (const item of items) item.reject(error);
    }
  }

  function flush() {
    const reads = waiting;
    waiting = [];
    if (reads.length === 1 || typeof driver.batch !== "function") {
      for (const item of reads)
        Promise.resolve(item.query as PromiseLike<unknown>).then(item.resolve, item.reject);
      return;
    }
    const size = Math.ceil(reads.length / Math.ceil(reads.length / PER_REQUEST));
    for (let start = 0; start < reads.length; start += size)
      void send(reads.slice(start, start + size));
  }

  return {
    read<Q extends ReadQuery>(query: Q): Promise<Awaited<Q>> {
      return new Promise<Awaited<Q>>((resolve, reject) => {
        try { validate(query); } catch (error) { reject(error); return; }
        if (!waiting.length) queueMicrotask(flush);
        waiting.push({ query, resolve: resolve as (value: unknown) => void, reject });
      });
    },
  };
}
