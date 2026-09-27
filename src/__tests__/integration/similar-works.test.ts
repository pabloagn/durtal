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
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_SIMILAR_WORKS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln327_test"
  )
    throw new Error("Similar works tests require disposable local sln327_test");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local DB required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
import { getSimilarWorks } from "@/lib/actions/similar-works";

describe.skipIf(!url)("similar works with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });

  const books: Record<string, { id: string; editions: string[] }> = {};
  const shelves: Record<string, string> = {};
  beforeEach(async () => {
    await db.execute(sql`truncate collections, works, authors cascade`);
    for (const [title, count] of [
      ["Target", 2],
      ["A", 2],
      ["B", 1],
      ["C", 1],
      ["D", 1],
      ["E", 1],
      ["X", 1],
    ] as const) {
      const [work] = await db
        .insert(schema.works)
        .values({ title })
        .returning();
      const eds = await db
        .insert(schema.editions)
        .values(
          Array.from({ length: count }, (_, i) => ({
            workId: work.id,
            title: `${title} ${i + 1}`,
          })),
        )
        .returning();
      books[title] = { id: work.id, editions: eds.map((e) => e.id) };
    }
    const [author] = await db
      .insert(schema.authors)
      .values({ name: "Author of C" })
      .returning();
    await db
      .insert(schema.workAuthors)
      .values({ workId: books.C.id, authorId: author.id });

    // Big (5 books) comes before Small (3 books); Other does not hold Target.
    for (const [name, sortOrder] of [
      ["Big", 0],
      ["Small", 1],
      ["Other", 2],
    ] as const) {
      const [c] = await db
        .insert(schema.collections)
        .values({ name, sortOrder })
        .returning();
      shelves[name] = c.id;
    }
    const members: [string, string][] = [
      ["Big", books.Target.editions[0]],
      ["Big", books.A.editions[0]],
      ["Big", books.A.editions[1]],
      ["Big", books.B.editions[0]],
      ["Big", books.C.editions[0]],
      ["Big", books.D.editions[0]],
      ["Small", books.Target.editions[1]],
      ["Small", books.C.editions[0]],
      ["Small", books.E.editions[0]],
      ["Other", books.X.editions[0]],
      ["Other", books.A.editions[0]],
    ];
    await db.insert(schema.collectionEditions).values(
      members.map(([name, editionId], sortOrder) => ({
        collectionId: shelves[name],
        editionId,
        sortOrder,
      })),
    );
  });

  const titles = async (title: string, limit?: number) =>
    (await getSimilarWorks(books[title].id, limit)).map((w) => w.title);

  it("ranks by shared collections, then the smaller collection, then collection order", async () => {
    // C shares both collections. E shares the small one. A, B, D share the big
    // one, in its member order. A has two editions there and counts once.
    // X is only in a collection Target is not in.
    expect(await titles("Target")).toEqual(["C", "E", "A", "B", "D"]);
    expect(await titles("Target", 2)).toEqual(["C", "E"]);
  });

  it("lists the shared collections as reasons, in collection order", async () => {
    const [c, e] = await getSimilarWorks(books.Target.id);
    expect(c.reasons).toEqual([
      { kind: "collection", id: shelves.Big, name: "Big" },
      { kind: "collection", id: shelves.Small, name: "Small" },
    ]);
    expect(e.reasons.map((r) => r.name)).toEqual(["Small"]);
  });

  it("returns card data for each work", async () => {
    const [c] = await getSimilarWorks(books.Target.id);
    expect(c.workAuthors.map((wa) => wa.author.name)).toEqual(["Author of C"]);
    expect(c.editions).toHaveLength(1);
    expect(c.media).toEqual([]);
  });

  it("follows the collection's own order inside one collection", async () => {
    expect(await titles("E")).toEqual(["Target", "C"]);
    // A shares the two-book Other with X only, so X comes before the Big members.
    expect(await titles("A")).toEqual(["X", "Target", "B", "C", "D"]);
  });

  it("returns nothing for a book in no collection, or alone in one", async () => {
    await db
      .delete(schema.collectionEditions)
      .where(sql`collection_id = ${shelves.Other}::uuid`);
    await db.insert(schema.collectionEditions).values({
      collectionId: shelves.Other,
      editionId: books.X.editions[0],
    });
    expect(await titles("X")).toEqual([]);
    const [lonely] = await db
      .insert(schema.works)
      .values({ title: "Lonely" })
      .returning();
    expect(await getSimilarWorks(lonely.id)).toEqual([]);
  });

  it("rejects a bad id or limit", async () => {
    await expect(getSimilarWorks("nope")).rejects.toThrow();
    await expect(getSimilarWorks(books.Target.id, 0)).rejects.toThrow();
  });
});
