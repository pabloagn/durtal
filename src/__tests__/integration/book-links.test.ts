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
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_LINKS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln322_test"
  ) {
    throw new Error(
      "Book link tests require a disposable local sln322_test database",
    );
  }
}
const client = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, prop) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, prop);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { updateWork, getWorkBySlug } from "@/lib/actions/works";

describe.skipIf(!url)("book links with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE works CASCADE`);
  });
  async function book() {
    return (
      await db
        .insert(schema.works)
        .values({
          title: "Fictions",
          slug: "fictions-test",
          catalogueStatus: "wanted",
          isRare: true,
          huntAssessedOn: "2026-09-25",
          notes: "Preserve this",
        })
        .returning()
    )[0];
  }
  async function read(id: string) {
    return (
      await db.select().from(schema.works).where(eq(schema.works.id, id))
    )[0];
  }

  it("saves canonical links and leaves every other field alone", async () => {
    const before = await book();
    await updateWork(before.id, {
      goodreadsUrl: " goodreads.com/book/show/7299.Fictions ",
      storygraphUrl: "http://app.thestorygraph.com/books/abc",
    });
    const after = await read(before.id);
    expect(after).toEqual({
      ...before,
      goodreadsUrl: "https://goodreads.com/book/show/7299.Fictions",
      storygraphUrl: "https://app.thestorygraph.com/books/abc",
      updatedAt: after.updatedAt,
    });
    const detail = await getWorkBySlug("fictions-test");
    expect(detail?.goodreadsUrl).toBe(
      "https://goodreads.com/book/show/7299.Fictions",
    );
  });

  it("clears one link with an empty value and keeps the other", async () => {
    const work = await book();
    await updateWork(work.id, {
      goodreadsUrl: "https://www.goodreads.com/book/show/1",
      storygraphUrl: "https://app.thestorygraph.com/books/1",
    });
    await updateWork(work.id, { goodreadsUrl: "" });
    const after = await read(work.id);
    expect(after.goodreadsUrl).toBeNull();
    expect(after.storygraphUrl).toBe("https://app.thestorygraph.com/books/1");
  });

  it("leaves links alone when an edit does not send them", async () => {
    const work = await book();
    await updateWork(work.id, {
      goodreadsUrl: "https://www.goodreads.com/book/show/1",
    });
    await updateWork(work.id, { notes: "Changed" });
    const after = await read(work.id);
    expect(after.goodreadsUrl).toBe("https://www.goodreads.com/book/show/1");
    expect(after.notes).toBe("Changed");
  });

  it("rejects a wrong site or a script link without writing anything", async () => {
    const work = await book();
    await expect(
      updateWork(work.id, {
        goodreadsUrl: "https://evil.example/book",
        notes: "No",
      }),
    ).rejects.toThrow();
    await expect(
      updateWork(work.id, { storygraphUrl: "javascript:alert(1)" }),
    ).rejects.toThrow();
    expect(await read(work.id)).toEqual(work);
  });
});
