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

// Inspect SQL tokens because a subquery's builder options are already folded
// into SQL by Drizzle's .as(). Skip quoted values/identifiers and PostgreSQL
// comments so their text cannot be mistaken for a locking clause.
function hasRowLock(source: string): boolean {
  const tokens: string[] = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith("--", i)) {
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++;
      continue;
    }
    if (source.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth++; i += 2; }
        else if (source.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    const quote = source[i];
    if (quote === "'" || quote === '"') {
      const escapes = quote === "'" && /[eE]/.test(source[i - 1] ?? "")
        && !/[\w$\u0080-\uFFFF]/.test(source[i - 2] ?? "");
      i++;
      while (i < source.length) {
        if (escapes && source[i] === "\\") { i += 2; continue; }
        if (source[i++] === quote) {
          if (source[i] === quote) i++;
          else break;
        }
      }
      tokens.push("quoted");
      continue;
    }
    const dollarQuote = source.slice(i).match(/^\$(?:[a-zA-Z_\u0080-\uFFFF][a-zA-Z_0-9\u0080-\uFFFF]*)?\$/)?.[0];
    if (dollarQuote) {
      const end = source.indexOf(dollarQuote, i + dollarQuote.length);
      i = end < 0 ? source.length : end + dollarQuote.length;
      tokens.push("quoted");
      continue;
    }
    const word = source.slice(i).match(/^[a-zA-Z_\u0080-\uFFFF][a-zA-Z_0-9$\u0080-\uFFFF]*/)?.[0];
    if (word) { tokens.push(word.toLowerCase()); i += word.length; }
    else tokens.push(source[i++]);
  }
  return tokens.some((token, i) => token === "for" && (
    tokens[i + 1] === "update" || tokens[i + 1] === "share"
    || (tokens[i + 1] === "no" && tokens[i + 2] === "key" && tokens[i + 3] === "update")
    || (tokens[i + 1] === "key" && tokens[i + 2] === "share")
  ));
}

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
    const compiled = query.toSQL();
    if (hasRowLock(compiled.sql))
      throw new Error("Read batching excludes locking clauses, including in subqueries");
    if (compiled.params.some((value) => is(value, Placeholder)
      || (is(value, Param) && is(value.value, Placeholder))))
      throw new Error("Read batching requires fully bound parameters");
    if (seen.has(query)) throw new Error("A read builder may be queued only once");
    seen.add(query);
  }

  async function send(items: WaitingRead[]) {
    try {
      const queries = items.map((item) => item.query) as [ReadQuery, ...ReadQuery[]];
      const results = await driver.batch!.call(connection, queries);
      if (!Array.isArray(results) || results.length !== items.length)
        throw new Error("Read batch returned an unexpected result count");
      // Missing findFirst results are explicit undefined entries, not holes.
      // Check every entry before resolving any promise in the chunk.
      if (items.some((_, i) => !Object.prototype.hasOwnProperty.call(results, i)))
        throw new Error("Read batch returned a missing result entry");
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
