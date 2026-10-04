import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_QUICK_SEARCH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln403_test")
    throw new Error("Quick search tests require disposable local sln403_test");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
import { quickSearch } from "@/lib/actions/quick-search";

describe.skipIf(!url)("command palette search pictures", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate works, authors, media cascade`);
  });

  async function author(name: string, photo?: string) {
    const [row] = await db
      .insert(schema.authors)
      .values({ name, slug: name.toLowerCase().replace(/\W+/g, "-"), photoS3Key: photo })
      .returning();
    return row;
  }
  async function work(title: string, by: string, cover?: string) {
    const [row] = await db.insert(schema.works).values({ title, slug: title.toLowerCase().replace(/\W+/g, "-") }).returning();
    await db.insert(schema.workAuthors).values({ workId: row.id, authorId: by });
    await db.insert(schema.editions).values({ workId: row.id, title, thumbnailS3Key: cover });
    return row;
  }

  it("gives each book its own cover: the active poster, else an edition's", async () => {
    const borges = await author("Jorge Luis Borges");
    const fictions = await work("Fictions", borges.id, "fictions-edition.webp");
    const labyrinths = await work("Labyrinths", borges.id, "labyrinths-edition.webp");
    await work("The Aleph", borges.id);
    await db.insert(schema.media).values([
      { workId: fictions.id, type: "poster", s3Key: "fictions.webp", thumbnailS3Key: "fictions-thumb.webp", isActive: true },
      // An inactive poster never shows
      { workId: labyrinths.id, type: "poster", s3Key: "old.webp", isActive: false },
    ]);
    const { works } = await quickSearch("borges");
    expect(Object.fromEntries(works.map((w) => [w.title, w.cover]))).toEqual({
      Fictions: "fictions-thumb.webp",
      Labyrinths: "labyrinths-edition.webp",
      "The Aleph": null,
    });
  });

  it("gives each author their portrait, else the legacy photo, else none", async () => {
    const borges = await author("Jorge Luis Borges");
    await author("Juan Carlos Onetti", "onetti-legacy.webp");
    await author("Juan Rulfo");
    await db.insert(schema.media).values({ authorId: borges.id, type: "poster", s3Key: "borges.webp", thumbnailS3Key: "borges-thumb.webp", isActive: true });
    const found = Object.fromEntries((await quickSearch("juan")).authors.map((a) => [a.name, a.photo]));
    expect(found).toEqual({ "Juan Carlos Onetti": "onetti-legacy.webp", "Juan Rulfo": null });
    expect((await quickSearch("borges")).authors).toMatchObject([{ name: "Jorge Luis Borges", photo: "borges-thumb.webp" }]);
  });
});
