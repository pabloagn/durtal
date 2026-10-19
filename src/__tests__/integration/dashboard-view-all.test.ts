import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

// The dashboard's shelves open on the same books and people as their View all
// lists, ties included (SLN-1070)

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_DASHBOARD_VIEW_ALL_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln1070_dashboard_view_all");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln1070_dashboard_view_all")
    throw new Error("Dashboard View all tests require a disposable local sln1070_dashboard_view_all database");
}
const client = url ? postgres(url, { prepare: false, max: 4, onnotice: () => {} }) : null;
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
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { getLibraryStats, getWorks } from "@/lib/actions/works";
import { getAuthors } from "@/lib/actions/authors";

describe.skipIf(!url)("the dashboard's shelves and their View all lists", () => {
  const c = client!;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln1070_dashboard_view_all");
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln1070_dashboard_view_all");
    // Twelve books in three batches, as one import adds them: equal times
    // and equal ratings, so only the tie-breaks decide the order
    const people = await c`insert into authors(name, sort_name, created_at)
      select 'Person ' || n, 'Person ' || n, now() - n * interval '1 day' from generate_series(1, 9) n returning id`;
    const books = await c`insert into works(title, slug, rating, created_at)
      select 'Book ' || n, 'book-' || n, case when n % 3 = 0 then 5 when n % 3 = 1 then 4 end,
        timestamptz '2026-10-01' + (n / 4) * interval '1 day'
      from generate_series(1, 12) n returning id`;
    // Each book's writers: a lead, and on every other book a second writer;
    // the older people are credited on the newer books
    for (const [i, book] of books.entries()) {
      await c`insert into work_authors(work_id, author_id, role, sort_order) values (${book.id}, ${people[(i * 2) % 9].id}, 'author', 0)`;
      if (i % 2) await c`insert into work_authors(work_id, author_id, role, sort_order) values (${book.id}, ${people[(i * 2 + 1) % 9].id}, 'author', 1)`;
    }
    // Someone with no book: never on the shelf, last on the list
    await c`insert into authors(name, sort_name, created_at) values ('No book', 'No book', now())`;
  }, 30000);

  it("Recent additions opens on the library's newest books", async () => {
    const stats = await getLibraryStats({ shelf: 8 });
    const list = await getWorks({ sort: "recent", limit: 8 });
    expect(stats.recentWorks.map((w) => w.id)).toEqual(list.map((w) => w.id));
  });

  it("Highest rated opens on the library's rating order, equal ratings included", async () => {
    const stats = await getLibraryStats({ shelf: 4 });
    const list = await getWorks({ sort: "rating", limit: 4 });
    expect(stats.topRatedWorks.map((w) => w.id)).toEqual(list.map((w) => w.id));
    expect(new Set(list.map((w) => w.rating))).toEqual(new Set([5]));
  });

  it("Recent people opens on people by their latest book", async () => {
    const shelf = (await getLibraryStats()).recentAuthors.map((a) => a.id);
    const list = await getAuthors({ sort: "latestBook", limit: 48 });
    // Every writer of the twelve books, each once, then the person with none
    expect(shelf).toHaveLength(9);
    expect(list.map((a) => a.id).slice(0, shelf.length)).toEqual(shelf);
    expect(list.at(-1)?.name).toBe("No book");
    // A page boundary keeps the order
    const pages = [...(await getAuthors({ sort: "latestBook", limit: 4 })), ...(await getAuthors({ sort: "latestBook", limit: 4, offset: 4 }))];
    expect(pages.map((a) => a.id)).toEqual(list.slice(0, 8).map((a) => a.id));
  });
});
