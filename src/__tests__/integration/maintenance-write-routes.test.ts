import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

/**
 * The write routes no other suite covers, against PostgreSQL:
 * POST /api/works/refresh-slugs and the reader's progress
 * (GET and POST /api/reader/[calibreId]/progress).
 */
// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_MAINTENANCE_ROUTES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln311_maintenance_routes"
  )
    throw new Error("Maintenance route tests require disposable local sln311_maintenance_routes");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate,
  CACHE_TAGS: new Proxy({}, { get: (_, key) => String(key) }),
}));
import { POST as refreshSlugs } from "@/app/api/works/refresh-slugs/route";
import {
  GET as getProgress,
  POST as postProgress,
} from "@/app/api/reader/[calibreId]/progress/route";

const TOKEN = "test-rest-token";
const post = (path: string, body?: unknown, token: string | null = TOKEN) =>
  new NextRequest(`http://local${path}`, {
    method: "POST",
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const calibre = (id: string) => ({ params: Promise.resolve({ calibreId: id }) });

describe.skipIf(!url)("maintenance write routes with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    vi.stubEnv("DURTAL_API_TOKEN", TOKEN);
    vi.spyOn(console, "error").mockImplementation(() => {});
    invalidate.mockClear();
    await db.execute(sql`truncate works, authors, calibre_books cascade`);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("POST /api/works/refresh-slugs", () => {
    /** A book by Huysmans whose slug kept an old title */
    async function book(title: string, slug: string) {
      const [work] = await db.insert(schema.works).values({ title, slug }).returning();
      const [author] = await db
        .insert(schema.authors)
        .values({ name: "J.-K. Huysmans", slug: `huysmans-${work.id.slice(0, 8)}` })
        .returning();
      await db.insert(schema.workAuthors).values({ workId: work.id, authorId: author.id });
      return work;
    }
    const slugOf = async (id: string) =>
      (await db.select({ slug: schema.works.slug }).from(schema.works).where(eq(schema.works.id, id)))[0].slug;

    it("needs the token", async () => {
      expect((await refreshSlugs(post("/api/works/refresh-slugs", undefined, null))).status).toBe(401);
      expect((await refreshSlugs(post("/api/works/refresh-slugs", undefined, "wrong"))).status).toBe(401);
      vi.stubEnv("DURTAL_API_TOKEN", "");
      expect((await refreshSlugs(post("/api/works/refresh-slugs"))).status).toBe(503);
    });

    it("dryRun=1 lists the changes and writes nothing", async () => {
      const renamed = await book("À rebours", "against-nature-huysmans");
      const res = await refreshSlugs(post("/api/works/refresh-slugs?dryRun=1"));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ dryRun: true, changed: 1 });
      expect(body.changes).toEqual([
        expect.objectContaining({ id: renamed.id, from: "against-nature-huysmans", to: expect.stringMatching(/^a-rebours/) }),
      ]);
      expect(await slugOf(renamed.id)).toBe("against-nature-huysmans");
      expect(invalidate).not.toHaveBeenCalled();
    });

    it("gives a stale slug the slug it should have, and leaves a fitting one", async () => {
      const renamed = await book("À rebours", "against-nature-huysmans");
      const fitting = await book("Là-bas", "placeholder");
      // The second book's slug is made to fit first
      await refreshSlugs(post(`/api/works/refresh-slugs?id=${fitting.id}`));
      const kept = await slugOf(fitting.id);
      const res = await refreshSlugs(post("/api/works/refresh-slugs"));
      const body = await res.json();
      expect(body).toMatchObject({ dryRun: false, checked: 2, changed: 1 });
      expect(body.changes[0]).toMatchObject({ id: renamed.id, to: await slugOf(renamed.id) });
      expect(await slugOf(renamed.id)).toMatch(/^a-rebours/);
      expect(await slugOf(fitting.id)).toBe(kept);
      expect(invalidate).toHaveBeenCalled();
      // Safe to run again
      expect(await (await refreshSlugs(post("/api/works/refresh-slugs"))).json()).toMatchObject({ changed: 0 });
    });

    it("id limits the run to one work, and an invalid id is refused", async () => {
      const a = await book("À rebours", "old-a");
      const b = await book("Là-bas", "old-b");
      const body = await (await refreshSlugs(post(`/api/works/refresh-slugs?id=${a.id}`))).json();
      expect(body).toMatchObject({ checked: 1, changed: 1 });
      expect(await slugOf(b.id)).toBe("old-b");
      expect((await refreshSlugs(post("/api/works/refresh-slugs?id=nope"))).status).toBe(400);
    });

    it("leaves the slugs of other collections alone", async () => {
      const [film] = await db
        .insert(schema.works)
        .values({ title: "Häxan", slug: "old-film-slug", kind: "film", originalLanguage: null })
        .returning();
      const body = await (await refreshSlugs(post("/api/works/refresh-slugs"))).json();
      expect(body.changed).toBe(0);
      expect(await slugOf(film.id)).toBe("old-film-slug");
    });
  });

  describe("/api/reader/[calibreId]/progress", () => {
    let bookId: string;
    beforeEach(async () => {
      const [row] = await db
        .insert(schema.calibreBooks)
        .values({ calibreId: 42, title: "À rebours", path: "Huysmans/A rebours (42)" })
        .returning();
      bookId = row.id;
    });
    const progress = async () =>
      (await db.select().from(schema.readingProgress).where(eq(schema.readingProgress.calibreBookId, bookId)))[0];

    it("has no progress before the first read", async () => {
      const res = await getProgress(post("/x"), calibre("42"));
      expect(await res.json()).toEqual({ progress: null });
    });

    it("saves the position, and a later save changes only the fields it sends", async () => {
      const first = await postProgress(
        post("/x", { cfi: "epubcfi(/6/4!/4/2)", page: 12.6, progressPercent: 0.25, currentChapter: "I" }),
        calibre("42"),
      );
      expect(await first.json()).toEqual({ ok: true });
      expect(await progress()).toMatchObject({
        currentCfi: "epubcfi(/6/4!/4/2)",
        currentPage: 13,
        progressPercent: 0.25,
        currentChapter: "I",
      });
      await postProgress(post("/x", { progressPercent: 0.5 }), calibre("42"));
      expect(await progress()).toMatchObject({
        currentCfi: "epubcfi(/6/4!/4/2)",
        currentPage: 13,
        progressPercent: 0.5,
        currentChapter: "I",
      });
      const read = await (await getProgress(post("/x"), calibre("42"))).json();
      expect(read.progress).toMatchObject({ progressPercent: 0.5 });
      expect(await db.select().from(schema.readingProgress)).toHaveLength(1);
    });

    it("keeps values inside their limits", async () => {
      await postProgress(
        post("/x", { page: -4, progressPercent: 1.7, cfi: "x".repeat(2500), currentChapter: "c".repeat(600) }),
        calibre("42"),
      );
      const row = await progress();
      expect(row).toMatchObject({ currentPage: 0, progressPercent: 1 });
      expect(row.currentCfi).toHaveLength(2000);
      expect(row.currentChapter).toHaveLength(500);
      await postProgress(post("/x", { progressPercent: -1 }), calibre("42"));
      expect((await progress()).progressPercent).toBe(0);
    });

    it("ignores fields of the wrong type", async () => {
      await postProgress(post("/x", { progressPercent: 0.3 }), calibre("42"));
      await postProgress(post("/x", { progressPercent: "0.9", page: "7", cfi: 5 }), calibre("42"));
      expect(await progress()).toMatchObject({ progressPercent: 0.3, currentPage: null, currentCfi: null });
    });

    it("answers 400 for a bad id or body and 404 for an unknown book", async () => {
      expect((await postProgress(post("/x", { page: 1 }), calibre("abc"))).status).toBe(400);
      expect((await postProgress(post("/x", "not json"), calibre("42"))).status).toBe(400);
      expect((await postProgress(post("/x", "null"), calibre("42"))).status).toBe(400);
      expect((await postProgress(post("/x", { page: 1 }), calibre("7"))).status).toBe(404);
      expect((await getProgress(post("/x"), calibre("7"))).status).toBe(404);
      expect(await db.select().from(schema.readingProgress)).toEqual([]);
    });
  });
});
