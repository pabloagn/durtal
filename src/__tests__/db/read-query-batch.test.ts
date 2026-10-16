import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";

vi.mock("@/lib/db", () => ({ db: {} }));
import { createReadBatch, type ReadQuery } from "@/lib/db/read-query-batch";

const db = drizzle.mock({ schema });
const select = () => db.select({ title: schema.works.title }).from(schema.works);

// Checked by TypeScript, never executed: batching must retain each projection
// and findFirst's optional result, and must not accept write/raw/prepared work.
function checkReadTypes() {
  const reads = createReadBatch(db);
  expectTypeOf(reads.read(select())).toEqualTypeOf<Promise<{ title: string }[]>>();
  expectTypeOf(reads.read(db.query.works.findFirst({ columns: { title: true } })))
    .toEqualTypeOf<Promise<{ title: string } | undefined>>();
  // @ts-expect-error Inserts are not reads, even with returning rows.
  reads.read(db.insert(schema.works).values({ title: "Write" }).returning());
  // @ts-expect-error Updates are not reads.
  reads.read(db.update(schema.works).set({ title: "Write" }).returning());
  // @ts-expect-error Deletes are not reads.
  reads.read(db.delete(schema.works).returning());
  // @ts-expect-error Raw SQL may write; it uses the existing separate API.
  reads.read(db.execute(sql`select 1`));
  // @ts-expect-error Prepared queries do not preserve the builder contract.
  reads.read(select().prepare("prepared"));
  // @ts-expect-error An already-started promise cannot be batched.
  reads.read(Promise.resolve([{ title: "Started" }]));
}

describe("function-scoped typed read batching", () => {
  it("keeps the read-only type contract", () => {
    expect(checkReadTypes).toBeTypeOf("function");
  });

  it("passes the original builders unchanged and returns mapped values unchanged", async () => {
    const queries = [select(), db.query.works.findFirst()];
    const rows = [{ title: "Mapped" }];
    const batch = vi.fn(async () => [rows, undefined]);
    const connection = { batch };
    const reads = createReadBatch(connection);
    const results = await Promise.all(queries.map((query) => reads.read(query)));
    expect(batch).toHaveBeenCalledExactlyOnceWith(queries);
    expect(batch.mock.contexts[0]).toBe(connection);
    expect(results[0]).toBe(rows);
    expect(results[1]).toBeUndefined();
  });

  it("balances chunks with at most eight reads and preserves input order", async () => {
    const queries = Array.from({ length: 17 }, select);
    const batch = vi.fn(async (items: ReadQuery[]) => items.map((query) => [queries.indexOf(query as typeof queries[number])]));
    const reads = createReadBatch({ batch });
    expect(await Promise.all(queries.map((query) => reads.read(query))))
      .toEqual(queries.map((_, index) => [index]));
    expect(batch.mock.calls.map(([items]) => items.length)).toEqual([6, 6, 5]);
  });

  it("does not combine independent instances or dependent waves", async () => {
    const batch = vi.fn(async (items: ReadQuery[]) => items.map(() => []));
    const a = createReadBatch({ batch });
    const b = createReadBatch({ batch });
    await Promise.all([a.read(select()), a.read(select()), b.read(select()), b.read(select())]);
    await Promise.all([a.read(select()), a.read(select())]);
    expect(batch.mock.calls.map(([items]) => items.length)).toEqual([2, 2, 2]);
  });

  it("awaits each original builder once when the driver has no batch", async () => {
    const a = select();
    const b = select();
    const executeA = vi.spyOn(a, "execute").mockResolvedValue([{ title: "A" }]);
    const executeB = vi.spyOn(b, "execute").mockResolvedValue([{ title: "B" }]);
    const reads = createReadBatch({});
    expect(await Promise.all([reads.read(a), reads.read(b)]))
      .toEqual([[{ title: "A" }], [{ title: "B" }]]);
    expect(executeA).toHaveBeenCalledTimes(1);
    expect(executeB).toHaveBeenCalledTimes(1);
  });

  it("awaits a single builder once without sending a batch", async () => {
    const query = select();
    const execute = vi.spyOn(query, "execute").mockResolvedValue([]);
    const batch = vi.fn();
    expect(await createReadBatch({ batch }).read(query)).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects only the failed chunk, and settles malformed batch responses", async () => {
    const error = new Error("Connection failed");
    const batch = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(Array.from({ length: 5 }, () => []));
    const reads = createReadBatch({ batch });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reads.read(select())));
    expect(results.map((result) => result.status)).toEqual([
      ...Array(5).fill("rejected"), ...Array(5).fill("fulfilled"),
    ]);
    expect(results[0]).toEqual({ status: "rejected", reason: error });
    const malformed = createReadBatch({ batch: async () => [[]] });
    const failures = await Promise.allSettled([malformed.read(select()), malformed.read(select())]);
    expect(failures.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  });

  it("rejects unsupported options before execution", async () => {
    const cte = db.$with("titles").as(select());
    const queries = [
      select().$withCache(),
      Object.assign(select(), { authToken: "test-token" }),
      select().for("update"),
      db.with(cte).select().from(cte),
      select().where(eq(schema.works.id, sql.placeholder("id"))),
      db.query.works.findFirst({ where: eq(schema.works.id, sql.placeholder("id")) }),
      db.insert(schema.works).values({ title: "Write" }).returning(),
      db.execute(sql`select 1`),
    ];
    const batch = vi.fn();
    const reads = createReadBatch({ batch });
    for (const query of queries)
      await expect(reads.read(query as ReadQuery)).rejects.toThrow();
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects a reused builder without executing it a second time", async () => {
    const query = select();
    const execute = vi.spyOn(query, "execute").mockResolvedValue([]);
    const reads = createReadBatch({});
    const first = reads.read(query);
    await expect(reads.read(query)).rejects.toThrow("only once");
    expect(await first).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
