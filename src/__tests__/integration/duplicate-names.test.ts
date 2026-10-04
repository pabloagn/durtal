import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

/**
 * A create or a rename to a value another record holds comes back as the
 * app's own message, never the database's "duplicate key" text: taxonomy
 * items, edition ISBNs (in the edition dialogs, the wizard and Fast Track).
 */
// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_DUPLICATE_NAMES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln303_duplicate_names"
  )
    throw new Error("Duplicate-name tests require disposable local sln303_duplicate_names");
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
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  cached: (fn: unknown) => fn,
  CACHE_TAGS: {},
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/covers", () => ({
  processAndUploadCover: vi.fn(async () => null),
  deleteFromS3: vi.fn(),
}));
import { createTaxonomyItem, updateTaxonomyItem } from "@/lib/actions/taxonomy-families";
import { createEdition, updateEdition } from "@/lib/actions/editions";
import { fastTrackBook } from "@/lib/actions/fast-track";
import { createBookFromWizard } from "@/lib/actions/wizard";

/** The database's own wording, which a reader must never see */
const RAW = /duplicate key|violates unique constraint|Failed query/;

describe.skipIf(!url)("duplicate names and numbers with PostgreSQL", () => {
  const db = testDb!;
  let workId: string;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate works, authors, keywords, activity_events, publishing_houses cascade`);
    const [work] = await db
      .insert(schema.works)
      .values({ title: "The Rings of Saturn", slug: "the-rings-of-saturn" })
      .returning();
    workId = work.id;
  });

  async function rejection(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toMatch(RAW);
    return error!.message;
  }

  describe("taxonomy items", () => {
    it("a rename to a name another item has gets the create's message", async () => {
      await createTaxonomyItem("keywords", { name: "Melancholy" });
      const other = await createTaxonomyItem("keywords", { name: "Walking" });
      expect(await rejection(updateTaxonomyItem("keywords", other.id, { name: "Melancholy" }))).toBe(
        "This family already has an item with this name",
      );
      // Nothing changed
      const names = await db.select({ name: schema.keywords.name }).from(schema.keywords);
      expect(names.map((n) => n.name).sort()).toEqual(["Melancholy", "Walking"]);
    });

    it("a create with a name another item has gets the same message", async () => {
      await createTaxonomyItem("keywords", { name: "Melancholy" });
      expect(await rejection(createTaxonomyItem("keywords", { name: "Melancholy" }))).toBe(
        "This family already has an item with this name",
      );
    });
  });

  describe("edition ISBNs", () => {
    it("the add dialog names the book that holds an ISBN-10", async () => {
      await createEdition({ workId, title: "First", isbn10: "0811214133" });
      expect(await rejection(createEdition({ workId, title: "Second", isbn10: "0811214133" }))).toBe(
        'An edition with ISBN 0811214133 already exists ("First")',
      );
    });

    it("the edit dialog names the book that holds an ISBN, and saves nothing", async () => {
      await createEdition({ workId, title: "First", isbn13: "9780811214131" });
      const second = await createEdition({ workId, title: "Second" });
      expect(
        await rejection(updateEdition(second.id, { title: "Changed", isbn13: "9780811214131" })),
      ).toBe('An edition with ISBN 9780811214131 already exists ("First")');
      const [kept] = await db
        .select({ title: schema.editions.title })
        .from(schema.editions)
        .where(sql`${schema.editions.id} = ${second.id}`);
      expect(kept.title).toBe("Second");
    });

    it("an edition keeps its own ISBN when it is edited", async () => {
      const first = await createEdition({ workId, title: "First", isbn13: "9780811214131" });
      await expect(
        updateEdition(first.id, { title: "Renamed", isbn13: "9780811214131" }),
      ).resolves.toEqual({ id: first.id });
    });

    it("the wizard refuses an ISBN-10, and Fast Track names the book that holds an ISBN", async () => {
      await createEdition({ workId, title: "First", isbn10: "0811214133", isbn13: "9780811214131" });
      const wizard = await createBookFromWizard({
        existingWorkId: workId,
        edition: { title: "Vertigo", isbn10: "0811214133" },
      });
      expect(wizard).toEqual({
        ok: false,
        error: 'An edition with ISBN 0811214133 already exists ("First")',
      });
      const fast = await fastTrackBook({
        authorName: "W. G. Sebald",
        work: { title: "Vertigo" },
        edition: { isbn13: "9780811214131" },
      });
      expect(fast).toEqual({
        ok: false,
        error: 'An edition with ISBN 9780811214131 already exists ("First"). Open that book to add a copy.',
      });
    });
  });
});
