import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_QUICK_SEARCH_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln403_test");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln403_test")
    throw new Error("Quick search tests require disposable local sln403_test");
}
const client = url ? postgres(url, { prepare: false, max: 4, onnotice: () => {} }) : null;
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
// This search request has no reader device cookie.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import { quickSearch } from "@/lib/actions/quick-search";

afterAll(async () => {
  await client?.end();
});

describe.skipIf(!url)("command palette search pictures", () => {
  const db = testDb!;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln403_test");
  }, 30000);
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln403_test");
  }, 30000);

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
    const found = Object.fromEntries((await quickSearch("juan")).people.map((a) => [a.name, a.photo]));
    expect(found).toEqual({ "Juan Carlos Onetti": "onetti-legacy.webp", "Juan Rulfo": null });
    expect((await quickSearch("borges")).people).toMatchObject([{ name: "Jorge Luis Borges", photo: "borges-thumb.webp" }]);
  });
});

describe.skipIf(!url)("command palette search for records found by name (SLN-966)", () => {
  const db = testDb!;
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln403_test");
  }, 30000);

  it("finds a series, a collection and a recommender, each opening its own page", async () => {
    const [rougon] = await db.insert(schema.series).values({ title: "Les Rougon-Macquart", slug: "les-rougon-macquart" }).returning();
    const [decadents] = await db.insert(schema.collections).values({ name: "Décadents" }).returning();
    const [bachelard] = await db.insert(schema.recommenders).values({ name: "Gaston Bachelard" }).returning();
    await db.insert(schema.series).values({ title: "La Comédie humaine", slug: "la-comedie-humaine" });

    expect((await quickSearch("rougon")).series).toEqual([{ id: rougon.id, name: "Les Rougon-Macquart", href: `/series/${rougon.id}` }]);
    // Accents and case are ignored
    expect((await quickSearch("DECADENTS")).collections).toEqual([{ id: decadents.id, name: "Décadents", href: `/collections/${decadents.id}` }]);
    expect((await quickSearch("bachelard")).recommenders).toEqual([{ id: bachelard.id, name: "Gaston Bachelard", href: `/recommenders/${bachelard.id}` }]);
    expect((await quickSearch("nothing like it")).series).toEqual([]);
  });

  it("finds taxonomy items of system and custom families, named by their family", async () => {
    const [subjects] = await db.select().from(schema.taxonomyFamilies).where(eq(schema.taxonomyFamilies.systemTable, "subjects"));
    const [occultism] = await db.insert(schema.subjects).values({ name: "Occultisme", slug: "occultisme" }).returning();
    const [moods] = await db.insert(schema.taxonomyFamilies).values({ name: "Moods", slug: "moods", systemTable: "custom_taxonomy_items" }).returning();
    await db.insert(schema.taxonomyApplicability).values({ familyId: moods.id, kind: "book", level: "work" }).onConflictDoNothing();
    const [melancholy] = await db.insert(schema.customTaxonomyItems).values({ familyId: moods.id, name: "Mélancolie", slug: "melancolie" }).returning();
    // A family no collection uses is left out
    const [unused] = await db.insert(schema.taxonomyFamilies).values({ name: "Unused", slug: "unused", systemTable: "custom_taxonomy_items" }).returning();
    await db.delete(schema.taxonomyApplicability).where(eq(schema.taxonomyApplicability.familyId, unused.id));
    await db.insert(schema.customTaxonomyItems).values({ familyId: unused.id, name: "Melancholia", slug: "melancholia" });

    expect((await quickSearch("occultisme")).taxonomy).toEqual([
      { id: occultism.id, name: "Occultisme", href: `/taxonomy/${subjects.slug}/occultisme`, detail: subjects.name },
    ]);
    expect((await quickSearch("melancolie")).taxonomy).toEqual([
      { id: melancholy.id, name: "Mélancolie", href: "/taxonomy/moods/melancolie", detail: "Moods" },
    ]);
  });
});
