import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

/* Reads started together go to the database as one request (the reading stats) */

const conn = vi.hoisted(() => ({
  batch: vi.fn() as ReturnType<typeof vi.fn> | undefined,
  execute: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_target, prop) => conn[prop as keyof typeof conn] }),
}));

import { batchedRows } from "@/lib/db/read-batch";

// db.execute is lazy: it names its query, and the batch or a then() runs it
const lazy = (query: unknown) => ({
  query,
  then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
    Promise.resolve({ rows: [{ alone: query }] }).then(resolve, reject),
});

afterEach(() => {
  conn.batch = vi.fn();
  conn.execute.mockReset();
});

describe("batchedRows", () => {
  it("sends the reads started together as one batch, each caller getting its own rows", async () => {
    conn.execute.mockImplementation(lazy);
    conn.batch!.mockImplementation(async (queries: { query: unknown }[]) => queries.map((_, i) => ({ rows: [{ n: i }] })));
    const [a, b, c] = await Promise.all([batchedRows(sql`select 1`), batchedRows(sql`select 2`), batchedRows(sql`select 3`)]);
    expect(conn.batch).toHaveBeenCalledTimes(1);
    expect(conn.batch!.mock.calls[0][0]).toHaveLength(3);
    expect([a, b, c]).toEqual([[{ n: 0 }], [{ n: 1 }], [{ n: 2 }]]);
  });

  it("splits a large wave into even batches sent side by side", async () => {
    conn.execute.mockImplementation(lazy);
    let open = 0, most = 0;
    conn.batch!.mockImplementation(async (queries: { query: unknown }[]) => {
      most = Math.max(most, ++open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open--;
      return queries.map((q) => ({ rows: [{ q: q.query }] }));
    });
    const queries = Array.from({ length: 31 }, (_, i) => sql`select ${i}`);
    const rows = await Promise.all(queries.map((query) => batchedRows(query)));
    expect(conn.batch!.mock.calls.map((call) => call[0].length)).toEqual([8, 8, 8, 7]);
    expect(most).toBe(4);
    expect(rows).toEqual(queries.map((q) => [{ q }]));
  });

  it("fails only the batch a failing read was in", async () => {
    conn.execute.mockImplementation(lazy);
    conn.batch!.mockRejectedValueOnce(new Error("connection lost")).mockImplementation(async (queries: unknown[]) => queries.map(() => ({ rows: [] })));
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => batchedRows(sql`select ${i}`)));
    expect(results.map((r) => r.status)).toEqual([...Array(5).fill("rejected"), ...Array(5).fill("fulfilled")]);
  });

  it("sends a read that waited on another in a batch of its own", async () => {
    conn.execute.mockImplementation(lazy);
    conn.batch!.mockImplementation(async (queries: unknown[]) => queries.map(() => ({ rows: [] })));
    await Promise.all([batchedRows(sql`select 1`), batchedRows(sql`select 2`)]);
    await Promise.all([batchedRows(sql`select 3`), batchedRows(sql`select 4`)]);
    expect(conn.batch).toHaveBeenCalledTimes(2);
  });

  it("runs a read alone without a batch", async () => {
    conn.execute.mockImplementation(lazy);
    const query = sql`select 1`;
    expect(await batchedRows(query)).toEqual([{ alone: query }]);
    expect(conn.batch).not.toHaveBeenCalled();
  });

  it("runs each read on its own on a driver without batch", async () => {
    conn.batch = undefined;
    conn.execute.mockImplementation(lazy);
    const rows = await Promise.all([batchedRows(sql`select 1`), batchedRows(sql`select 2`)]);
    expect(conn.execute).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
  });

  // SLN-1309: the reading stats compile nothing; the setting rides each request's own transaction
  it("heads each request of a wave with set local jit = off when its reads ask for it", async () => {
    conn.execute.mockImplementation(lazy);
    conn.batch!.mockImplementation(async (queries: { query: unknown }[]) => queries.map((q) => ({ rows: [{ q: q.query }] })));
    const queries = Array.from({ length: 10 }, (_, i) => sql`select ${i}`);
    const rows = await Promise.all(queries.map((query) => batchedRows(query, { jit: false })));
    const text = (q: unknown) => (q as { queryChunks: { value: string[] }[] }).queryChunks.map((c) => c.value?.join("") ?? "").join("");
    expect(conn.batch!.mock.calls.map((call) => call[0].length)).toEqual([6, 6]);
    for (const call of conn.batch!.mock.calls) expect(text(call[0][0].query)).toBe("set local jit = off");
    expect(rows).toEqual(queries.map((q) => [{ q }]));
  });

  it("sends a lone read without JIT in a batch, so the setting holds for it", async () => {
    conn.execute.mockImplementation(lazy);
    conn.batch!.mockImplementation(async (queries: unknown[]) => queries.map((_, i) => ({ rows: [{ n: i }] })));
    expect(await batchedRows(sql`select 1`, { jit: false })).toEqual([{ n: 1 }]);
    expect(conn.batch!.mock.calls[0][0]).toHaveLength(2);
  });

  it("leaves JIT alone for reads that don't ask", async () => {
    conn.execute.mockImplementation(lazy);
    conn.batch!.mockImplementation(async (queries: unknown[]) => queries.map(() => ({ rows: [] })));
    await Promise.all([batchedRows(sql`select 1`), batchedRows(sql`select 2`)]);
    expect(conn.batch!.mock.calls[0][0]).toHaveLength(2);
  });

  it("fails every read of a batch that fails", async () => {
    conn.execute.mockImplementation(lazy);
    conn.batch!.mockRejectedValue(new Error("connection lost"));
    const results = await Promise.allSettled([batchedRows(sql`select 1`), batchedRows(sql`select 2`)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });
});
