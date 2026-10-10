import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { describe, it, expect, vi, beforeEach } from "vitest";

// A fake connection: `batch` is present (neon-http) or removed (postgres-js).
const fake: {
  batch?: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
} = {
  batch: vi.fn(),
  transaction: vi.fn(),
};
vi.mock("@/lib/db", () => ({ db: fake }));

const { atomic, atomicOn } = await import("@/lib/db/atomic");
const { editionWriteGuardQueries, editionUpdateQuery } = await import("@/lib/catalogue/edition-write-guard");

beforeEach(() => {
  fake.batch = vi.fn(async (queries: unknown[]) =>
    queries.map((q) => `ran:${q}`),
  );
  fake.transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown[]>) =>
    run({ tx: true }),
  );
});

describe("atomic()", () => {
  it("sends every query in ONE batch when the driver has batch (neon-http)", async () => {
    const results = await atomic(() => ["a", "b", "c"]);
    expect(fake.batch).toHaveBeenCalledTimes(1);
    expect(fake.batch).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(results).toEqual(["ran:a", "ran:b", "ran:c"]);
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it("sends nothing for an empty list (neon rejects an empty batch)", async () => {
    expect(await atomic(() => [])).toEqual([]);
    expect(fake.batch).not.toHaveBeenCalled();
  });

  it("builds the queries on the transaction when there is no batch", async () => {
    delete fake.batch;
    const seen: unknown[] = [];
    const results = await atomic((d) => {
      seen.push(d);
      return [Promise.resolve(1), Promise.resolve(2)];
    });
    expect(fake.transaction).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ tx: true }]);
    expect(results).toEqual([1, 2]);
  });

  it("passes a failure through, so the caller sees it", async () => {
    fake.batch = vi.fn(async () => {
      throw new Error("violates foreign key constraint");
    });
    await expect(atomic(() => ["a"])).rejects.toThrow("foreign key");
  });
  it.each(["batch", "transaction"] as const)("keeps the cover writer lock, fresh assertion and counted mutation ordered in one %s", async driver => {
    const executed: SQL[] = [], built: SQL[] = [];
    const execute = (query: SQL) => {
      built.push(query);
      return { then: (resolve: (rows: unknown[]) => unknown) => { executed.push(query); return Promise.resolve([]).then(resolve); } };
    };
    const conn = {
      execute,
      ...(driver === "batch" ? { batch: async (queries: PromiseLike<unknown>[]) => {
        expect(executed).toEqual([]); return Promise.all(queries);
      } } : {}),
      transaction: async (run: (tx: unknown) => Promise<unknown[]>) => run({ execute }),
    } as unknown as Db;
    await atomicOn(conn, d => [
      ...editionWriteGuardQueries(d, { editionId: "10000000-0000-4000-8000-000000000001", state: '{"edition":{"updated_at":"2026-10-10T10:00:00.000001"},"related":{}}' }),
      editionUpdateQuery(d, "10000000-0000-4000-8000-000000000001", { title: "Changed", updatedAt: new Date("2026-10-10T10:00:01Z") }),
    ]);
    expect(executed).toEqual(built);
    const compiled = executed.map(query => new PgDialect().sqlToQuery(query));
    expect(compiled).toHaveLength(3);
    expect(compiled[0].sql).toMatch(/^lock table/);
    expect(compiled[1].sql).toContain("harmonization_assert");
    expect(compiled[1].params).toContain('{"edition":{"updated_at":"2026-10-10T10:00:00.000001"},"related":{}}');
    expect(compiled[2].sql).toContain("with changed as");
    expect(compiled[2].sql).toContain("count(*)");
  });

});
