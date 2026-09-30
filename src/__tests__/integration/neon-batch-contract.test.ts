import { randomUUID } from "node:crypto";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import postgres from "postgres";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_NEON_BATCH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln348_batch_test"
  )
    throw new Error(
      "Neon batch contract tests require disposable local sln348_batch_test",
    );
}
const client = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const httpDb = url ? neonDrizzle(neon(url), { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!httpDb) throw new Error("Local test database required");
        return Reflect.get(httpDb, key);
      },
    },
  ),
}));
import { atomic } from "@/lib/db/atomic";

type Query = { query: string; params: (string | null)[] };

describe.skipIf(!url)("production Neon driver batch contract", () => {
  const c = client!;
  const requests: { queries?: Query[]; query?: string }[] = [];
  const previousFetch = neonConfig.fetchFunction;

  beforeAll(async () => {
    await migrate(postgresDrizzle(c), {
      migrationsFolder: "src/lib/db/migrations",
    });
    // Use the actual Neon client and Drizzle driver. Only the HTTP endpoint is
    // replaced: its batch protocol executes against disposable PostgreSQL.
    // This verifies our driver path and SQL atomicity, not the hosted service.
    neonConfig.fetchFunction = async (
      _endpoint: string,
      options?: RequestInit,
    ) => {
      const body = JSON.parse(String(options?.body)) as
        | Query
        | { queries: Query[] };
      requests.push(body);
      try {
        const results = await c.begin(async (tx) => {
          const output = [];
          for (const query of "queries" in body ? body.queries : [body]) {
            const rows = await tx.unsafe(query.query, query.params).values();
            output.push({
              command: rows.command,
              rowCount: rows.count,
              fields: rows.columns.map((column) => ({
                name: column.name,
                dataTypeID: column.type,
              })),
              rows: rows.map((row) =>
                row.map((value: unknown) =>
                  value === null
                    ? null
                    : value instanceof Date
                      ? value.toISOString()
                      : typeof value === "object"
                        ? JSON.stringify(value)
                        : typeof value === "boolean"
                          ? value
                            ? "t"
                            : "f"
                          : String(value),
                ),
              ),
            });
          }
          return output;
        });
        return Response.json("queries" in body ? { results } : results[0]);
      } catch (error) {
        const pg = error as { message: string; code: string; detail?: string };
        return Response.json(
          { message: pg.message, code: pg.code, detail: pg.detail },
          { status: 400 },
        );
      }
    };
  }, 30000);
  afterAll(async () => {
    neonConfig.fetchFunction = previousFetch;
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works cascade`;
    requests.length = 0;
  });

  it("sends one HTTP batch with ordered queries and maps returning rows", async () => {
    const id = randomUUID();
    const results = await atomic((d) => [
      d
        .insert(schema.works)
        .values({ id, title: "Batch book" })
        .returning({ id: schema.works.id, kind: schema.works.kind }),
      d
        .insert(schema.editions)
        .values({ workId: id, title: "Batch edition" })
        .returning({ workId: schema.editions.workId }),
      d.execute(
        sql`select count(*)::int as count from editions where work_id = ${id}`,
      ),
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].queries).toHaveLength(3);
    expect(results[0]).toEqual([{ id, kind: "book" }]);
    expect(results[1]).toEqual([{ workId: id }]);
    expect(results[2]).toMatchObject({ rows: [{ count: 1 }] });
    expect(await c`select title from works`).toEqual([{ title: "Batch book" }]);
  });
  it("rolls back earlier writes when a later statement violates a database constraint", async () => {
    const id = randomUUID();
    await expect(
      atomic((d) => [
        d.insert(schema.works).values({ id, title: "Must roll back" }),
        d
          .insert(schema.editions)
          .values({ workId: randomUUID(), title: "Missing parent" }),
        d.insert(schema.works).values({ title: "Must not run" }),
      ]),
    ).rejects.toThrow(/requires an existing book/);
    expect(requests).toHaveLength(1);
    expect(requests[0].queries).toHaveLength(3);
    expect(await c`select id from works`).toHaveLength(0);
    expect(await c`select id from editions`).toHaveLength(0);
  });
  it("does not send empty batches or fall back to unsupported interactive transactions", async () => {
    expect(await atomic(() => [])).toEqual([]);
    expect(requests).toHaveLength(0);
    await expect(httpDb!.transaction(async () => undefined)).rejects.toThrow(
      "No transactions support",
    );
  });
});
