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
const url = process.env.DURTAL_PUBLISHER_LIST_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln328_test"
  )
    throw new Error(
      "Publisher list tests require disposable local sln328_test",
    );
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
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  cached: (fn: () => unknown) => fn,
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
import { getPublishers, getPublisherCountries } from "@/lib/actions/publishers";
import {
  authorSearchCondition,
  authorSearchRank,
} from "@/lib/actions/utils/author-search";

describe.skipIf(!url)("publisher list with PostgreSQL", () => {
  const db = testDb!;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate publishing_houses, works, authors cascade`);
    const add = async (
      name: string,
      extra: Partial<typeof schema.publishingHouses.$inferInsert> = {},
    ) => {
      const [row] = await db
        .insert(schema.publishingHouses)
        .values({
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          ...extra,
        })
        .returning();
      ids[name] = row.id;
      return row;
    };
    await add("Éditions Gallimard", { country: "France" });
    const nyrb = await add("New York Review Books", {
      country: "United States",
      isFavourite: true,
    });
    await db
      .insert(schema.publisherAliases)
      .values({ publisherId: nyrb.id, name: "NYRB" });
    await add("Wakefield Press", { country: "United States" });
    const penguin = await add("Penguin Books", { country: "United Kingdom" });
    await add("Penguin Classics", {
      country: "United Kingdom",
      kind: "imprint",
      parentId: penguin.id,
    });
    await add("Faber & Faber", { country: "United Kingdom; United States" });

    const [work] = await db
      .insert(schema.works)
      .values({ title: "Book" })
      .returning();
    const eds = await db
      .insert(schema.editions)
      .values([
        { workId: work.id, title: "A" },
        { workId: work.id, title: "B" },
        { workId: work.id, title: "C" },
      ])
      .returning();
    await db.insert(schema.editionPublishers).values([
      { editionId: eds[0].id, publisherId: ids["Wakefield Press"] },
      { editionId: eds[1].id, publisherId: ids["Wakefield Press"] },
      { editionId: eds[2].id, publisherId: ids["Penguin Classics"] },
    ]);
  });
  const names = async (options: Parameters<typeof getPublishers>[0]) =>
    (await getPublishers(options)).rows.map((r) => r.publisher.name);

  it("finds publishers ignoring accents, word order and typos, and by alias", async () => {
    expect(await names({ search: "gallimard editions" })).toEqual([
      "Éditions Gallimard",
    ]);
    expect(await names({ search: "nyrb" })).toEqual(["New York Review Books"]);
    expect(await names({ search: "Wakefeild" })).toEqual(["Wakefield Press"]);
    expect(await names({ search: "zzzz" })).toEqual([]);
  });

  it("ranks the best match first when searching", async () => {
    const found = await names({ search: "penguin books" });
    expect(found[0]).toBe("Penguin Books");
  });

  it("filters by favourites, type and single countries of multi-country publishers", async () => {
    expect(await names({ favourites: true })).toEqual([
      "New York Review Books",
    ]);
    expect(await names({ kinds: ["imprint"] })).toEqual(["Penguin Classics"]);
    expect(await names({ countries: ["United States"] })).toEqual([
      "Faber & Faber",
      "New York Review Books",
      "Wakefield Press",
    ]);
    expect(await getPublisherCountries()).toEqual([
      "France",
      "United Kingdom",
      "United States",
    ]);
  });

  it("sorts by name, editions and recency, and reports parents and counts", async () => {
    expect(await names({})).toEqual([
      "Éditions Gallimard",
      "Faber & Faber",
      "New York Review Books",
      "Penguin Books",
      "Penguin Classics",
      "Wakefield Press",
    ]);
    const byEditions = (await getPublishers({ sort: "editions" })).rows;
    expect(byEditions[0].publisher.name).toBe("Wakefield Press");
    expect(byEditions[0].editionCount).toBe(2);
    // A parent counts its imprints' editions.
    expect(
      byEditions.find((r) => r.publisher.name === "Penguin Books")!
        .editionCount,
    ).toBe(1);
    expect(
      byEditions.find((r) => r.publisher.name === "Penguin Classics")!
        .parentName,
    ).toBe("Penguin Books");
    // Page sizes follow the shared paging choices; the total covers all pages.
    const first = await getPublishers({ page: 1 });
    expect(first.total).toBe(6);
    expect((await getPublishers({ page: 2 })).rows).toHaveLength(0);
  });

  it("keeps author search behaviour after sharing the engine", async () => {
    await db
      .insert(schema.authors)
      .values([
        { name: "Péter Nádas" },
        { name: "László Krasznahorkai" },
        { name: "Peter Handke" },
      ]);
    const find = async (q: string) =>
      (
        await db
          .select({ name: schema.authors.name })
          .from(schema.authors)
          .where(authorSearchCondition(q))
          .orderBy(sql`${authorSearchRank(q)} desc`)
      ).map((r) => r.name);
    expect(await find("nadas peter")).toEqual(["Péter Nádas"]);
    expect(await find("Krasnahorkai")).toEqual(["László Krasznahorkai"]);
    expect(await find("peter")).toHaveLength(2);
  });
});
