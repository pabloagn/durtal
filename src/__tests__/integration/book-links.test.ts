import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
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
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_LINKS_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln322_test");
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
const client = url ? postgres(url, { prepare: false, max: 1, onnotice: () => {} }) : null;
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
    await resetDisposableDatabase(url!, "sln322_test");
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln322_test");
  }, 30000);
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

  it("validates a sparse update without resetting creation defaults", async () => {
    const work = await book();
    await db
      .update(schema.works)
      .set({
        originalLanguage: "fr",
        catalogueStatus: "wanted",
        acquisitionPriority: "urgent",
        isAnthology: true,
      })
      .where(eq(schema.works.id, work.id));
    const before = await read(work.id);

    await updateWork(work.id, { notes: "Only the note changes" });

    const after = await read(work.id);
    expect(after).toEqual({
      ...before,
      notes: "Only the note changes",
      updatedAt: after.updatedAt,
    });
  });

  // SLN-1132: the book page's editions, in this file as it reads a book page's work
  it("lists a book's editions with the original language first, then the newest, then by title", async () => {
    const [work] = await db
      .insert(schema.works)
      .values({ title: "Against Nature", slug: "against-nature-test", originalLanguage: "fr" })
      .returning();
    await db.insert(schema.editions).values([
      { workId: work.id, title: "Penguin", language: "en" },
      { workId: work.id, title: "Against Nature", language: "en", publicationYear: 2003 },
      { workId: work.id, title: "À rebours", language: "fr" },
      { workId: work.id, title: "A Rebours", language: "fr", publicationYear: 1884 },
      { workId: work.id, title: "Gegen den Strich", language: "de", publicationYear: 2003 },
    ]);
    const titles = async () => (await getWorkBySlug("against-nature-test"))!.editions.map((e) => e.title);
    const order = ["A Rebours", "À rebours", "Against Nature", "Gegen den Strich", "Penguin"];
    expect(await titles()).toEqual(order);
    // Stable: the same order on every load
    expect(await titles()).toEqual(order);
  });
});

