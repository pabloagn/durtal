/** Verified transaction-bound planning for pooled PostgreSQL connections. */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
import { databaseErrorCode } from "@/lib/db/errors";

/** A failed write probe rolls back only its savepoint, leaving planning usable. */
export async function assertReadOnly(
  transaction: postgres.TransactionSql,
): Promise<void> {
  const [setting] =
    await (transaction as unknown as postgres.Sql)`show transaction_read_only`;
  if (setting?.transaction_read_only !== "on")
    throw new Error(
      "The database transaction is not read-only; transaction_read_only is not on; nothing ran",
    );
  const refused = await transaction
    .savepoint(
      (probe) =>
        (probe as unknown as postgres.Sql)`update works set updated_at = updated_at where false`,
    )
    .then(
      () => false,
      (error: unknown) => databaseErrorCode(error) === "25006",
    );
  if (!refused)
    throw new Error(
      "The database accepted a write in the read-only session; nothing ran",
    );
}

/**
 * All loader/helper reads must use this database, and finish inside the awaited
 * callback. Return data, not connections or queries. The explicit transaction
 * pins the pooled connection; startup defaults cannot provide this guarantee.
 */
export async function withReadOnlyPlanningConnection<T>(
  url: string,
  work: (database: Db) => Promise<T>,
): Promise<T> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  let active = false;
  let closed = false;
  const requireActive = () => {
    if (!active || closed)
      throw new Error(
        "The read-only planning connection is closed; run its reads inside the callback",
      );
  };
  try {
    // Await the whole transaction before closing its owning client.
    return (await client.begin("read only", async (transaction) => {
      await assertReadOnly(transaction);
      active = !closed;
      requireActive();
      // Drizzle calls unsafe at execution, including for retained prepared queries.
      // Nested database transactions use savepoints on this same protected connection.
      const protectedClient = new Proxy(transaction, {
        get(target, property, receiver) {
          if (property === "options") return client.options;
          if (property === "begin")
            return (
              callback: (nested: postgres.TransactionSql) => Promise<unknown>,
            ) => {
              requireActive();
              return target.savepoint(callback);
            };
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function"
            ? (...args: unknown[]) => {
                requireActive();
                return Reflect.apply(value, target, args);
              }
            : value;
        },
      });
      const database = drizzle(protectedClient as unknown as postgres.Sql, {
        schema,
        logger: { logQuery: requireActive },
      }) as unknown as Db;
      try {
        return await work(database);
      } finally {
        active = false;
      }
    })) as T;
  } finally {
    // begin can reject on connection loss before the callback itself settles.
    closed = true;
    active = false;
    await client.end();
  }
}
