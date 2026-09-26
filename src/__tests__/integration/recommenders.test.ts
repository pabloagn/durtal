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
const url = process.env.DURTAL_RECOMMENDER_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln329_test"
  )
    throw new Error("Recommender tests require disposable local sln329_test");
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
import { invalidate } from "@/lib/cache";
import {
  createRecommender,
  updateRecommender,
  deleteRecommender,
  getRecommender,
  getRecommenderList,
  getRecommenders,
} from "@/lib/actions/recommenders";

describe.skipIf(!url)("recommenders with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate recommenders, works, authors cascade`);
    vi.clearAllMocks();
  });
  async function book(title: string) {
    const [work] = await db.insert(schema.works).values({ title }).returning();
    const [author] = await db
      .insert(schema.authors)
      .values({ name: `${title} Author` })
      .returning();
    await db
      .insert(schema.workAuthors)
      .values({ workId: work.id, authorId: author.id });
    await db
      .insert(schema.media)
      .values({ workId: work.id, type: "poster", s3Key: `${title}.webp` });
    return work;
  }
  async function created(input: Parameters<typeof createRecommender>[0]) {
    const result = await createRecommender(input);
    if (!result.ok) throw new Error(result.error);
    return result.recommender;
  }
  async function link(recommenderId: string, workId: string) {
    await db.insert(schema.workRecommenders).values({ recommenderId, workId });
  }

  it("creates with a normalized website and refreshes the cached list", async () => {
    const r = await createRecommender({
      name: " Life on Books ",
      url: "youtube.com/@Lifeonbooks",
    });
    expect(r).toMatchObject({
      ok: true,
      recommender: {
        name: "Life on Books",
        url: "https://youtube.com/@Lifeonbooks",
      },
    });
    expect(invalidate).toHaveBeenCalledWith("recommenders", "works");
    expect((await getRecommenders()).map((x) => x.name)).toEqual([
      "Life on Books",
    ]);
  });

  it("rejects names that differ only by case or accents, with a message", async () => {
    await created({ name: "Café Crème" });
    expect(await createRecommender({ name: "cafe creme" })).toEqual({
      ok: false,
      error: '"Café Crème" already exists',
    });
    const other = await created({ name: "Claude" });
    expect(await updateRecommender(other.id, { name: "CAFÉ CRÈME" })).toEqual({
      ok: false,
      error: '"Café Crème" already exists',
    });
    // Renaming to the same name (only case) is allowed for itself.
    expect(
      await updateRecommender(other.id, { name: "claude", url: null }),
    ).toMatchObject({
      ok: true,
      recommender: { name: "claude", url: null },
    });
    // Invalid input comes back as a message, and nothing is written.
    expect(
      await createRecommender({ name: "X", url: "javascript:alert(1)" }),
    ).toMatchObject({ ok: false });
    expect(await getRecommenders()).toHaveLength(2);
  });

  it("deletes a recommender and its links, keeping the books", async () => {
    const r = await created({ name: "ChatGPT", url: "chatgpt.com" });
    const w = await book("Demons");
    await link(r.id, w.id);
    await deleteRecommender(r.id);
    expect(await getRecommender(r.id)).toBeUndefined();
    expect(await db.select().from(schema.works)).toHaveLength(1);
    expect(await db.select().from(schema.workRecommenders)).toHaveLength(0);
  });

  it("searches like authors and sorts by book count", async () => {
    const life = await created({ name: "Life on Books" });
    const leaf = await created({ name: "Leaf by Leaf" });
    await created({ name: "Café Crème" });
    const a = await book("A");
    const b = await book("B");
    await link(leaf.id, a.id);
    await link(leaf.id, b.id);
    await link(life.id, a.id);
    const names = async (o: Parameters<typeof getRecommenderList>[0]) =>
      (await getRecommenderList(o)).rows.map((r) => r.name);
    expect(await names({ search: "cafe" })).toEqual(["Café Crème"]);
    expect(await names({ search: "life on boks" })).toEqual(["Life on Books"]);
    expect(await names({})).toEqual([
      "Café Crème",
      "Leaf by Leaf",
      "Life on Books",
    ]);
    const byBooks = (await getRecommenderList({ sort: "books" })).rows;
    expect(byBooks.map((r) => [r.name, r.bookCount])).toEqual([
      ["Leaf by Leaf", 2],
      ["Life on Books", 1],
      ["Café Crème", 0],
    ]);
    expect((await getRecommenderList({ search: "zzzz" })).total).toBe(0);
  });

  it("returns the recommended books by title with authors and posters", async () => {
    const r = await created({ name: "Life on Books" });
    const z = await book("Zazie");
    const b = await book("Baron Wenckheim's Homecoming");
    await link(r.id, z.id);
    await link(r.id, b.id);
    const found = await getRecommender(r.id);
    expect(found!.books.map((w) => w.title)).toEqual([
      "Baron Wenckheim's Homecoming",
      "Zazie",
    ]);
    expect(found!.books[0].workAuthors[0].author.name).toBe(
      "Baron Wenckheim's Homecoming Author",
    );
    expect(found!.books[0].media[0].type).toBe("poster");
    expect(await getRecommender("not-a-uuid")).toBeUndefined();
  });
});
