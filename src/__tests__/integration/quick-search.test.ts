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
import { workSearchCondition } from "@/lib/library/search-condition";
import { authorSearchCondition } from "@/lib/actions/utils/author-search";

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

  it("finds a series by its original title, as the series list does", async () => {
    const [gormenghast] = await db.insert(schema.series).values({ title: "Gormenghast", originalTitle: "Titus books", slug: "gormenghast" }).returning();

    expect((await quickSearch("titus")).series).toEqual([{ id: gormenghast.id, name: "Gormenghast", href: `/series/${gormenghast.id}` }]);
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

  it("drops a NUL character, which Postgres refuses, instead of failing (SLN-1137)", async () => {
    const [press] = await db.insert(schema.publishingHouses).values({ name: "Nadja Press", slug: "nadja-press" }).returning();
    const [series] = await db.insert(schema.series).values({ title: "Nadja", slug: "nadja" }).returning();

    const found = await quickSearch("nad\u0000ja");
    expect(found.organizations).toEqual([{ id: press.id, name: "Nadja Press", href: "/publishers/nadja-press", roles: "Publisher" }]);
    expect(found.series).toEqual([{ id: series.id, name: "Nadja", href: `/series/${series.id}` }]);
  });
});

describe.skipIf(!url)("search in every script, through the palette, Books and People (SLN-1234)", () => {
  const db = testDb!;
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln403_test");
  }, 30000);

  async function book(title: string, by: string) {
    const [found] = await db.select().from(schema.authors).where(eq(schema.authors.name, by));
    const author = found ?? (await db.insert(schema.authors).values({ name: by, slug: `p-${Math.random().toString(36).slice(2)}` }).returning())[0];
    const [work] = await db.insert(schema.works).values({ title, slug: `w-${Math.random().toString(36).slice(2)}` }).returning();
    await db.insert(schema.workAuthors).values({ workId: work.id, authorId: author.id });
    return work;
  }
  const palette = async (q: string) => {
    const found = await quickSearch(q);
    return { works: found.works.map((w) => w.title).sort(), people: found.people.map((p) => p.name).sort() };
  };
  const books = async (q: string) =>
    (await db.select({ title: schema.works.title }).from(schema.works).where(workSearchCondition(q))).map((w) => w.title).sort();
  const people = async (q: string) =>
    (await db.select({ name: schema.authors.name }).from(schema.authors).where(authorSearchCondition(q))).map((a) => a.name).sort();

  it("finds Korean, Japanese, Cyrillic and Devanagari as typed, and Latin, ё, Greek and Turkish folded", async () => {
    await book("채식주의자", "한강");
    await book("吾輩は猫である", "夏目漱石");
    await book("Преступление и наказание", "Фёдор Достоевский");
    await book("Ёлка", "Фёдор Достоевский");
    await book("गोदान", "प्रेमचंद");
    await book("Emlékiratok könyve", "Péter Nádas");
    await book("Άξιον Εστί", "Οδυσσέας Ελύτης");
    await book("İstanbul Hatırası", "Ahmet Ümit");
    await book("The Owl and the Pussy-cat", "Edward Lear");

    // The palette: people and their books, and titles
    expect(await palette("한강")).toEqual({ works: ["채식주의자"], people: ["한강"] });
    expect((await palette("채식주의자")).works).toEqual(["채식주의자"]);
    expect((await palette("猫である")).works).toEqual(["吾輩は猫である"]);
    expect(await palette("Достоевский")).toEqual({ works: ["Ёлка", "Преступление и наказание"], people: ["Фёдор Достоевский"] });
    expect((await palette("प्रेमचंद")).people).toEqual(["प्रेमचंद"]);
    expect((await palette("NADAS peter")).people).toEqual(["Péter Nádas"]);
    // One CJK character is a word; symbols alone search nothing
    expect((await palette("猫")).works).toEqual(["吾輩は猫である"]);
    expect(await palette("🦉")).toEqual({ works: [], people: [] });
    expect(await palette("a")).toEqual({ works: [], people: [] });

    // Books: by author and by title
    expect(await books("Достоевский")).toEqual(["Ёлка", "Преступление и наказание"]);
    expect(await books("한강")).toEqual(["채식주의자"]);
    expect(await books("猫である")).toEqual(["吾輩は猫である"]);
    expect(await books("प्रेमचंद")).toEqual(["गोदान"]);
    expect(await books("nadas")).toEqual(["Emlékiratok könyve"]);

    // People
    expect(await people("प्रेमचंद")).toEqual(["प्रेमचंद"]);
    expect(await people("достоевский")).toEqual(["Фёдор Достоевский"]);

    // Folding as before: ё, Greek accents, Turkish İ and ı, Latin accents
    expect(await books("елка")).toEqual(["Ёлка"]);
    expect(await books("ёлка")).toEqual(["Ёлка"]);
    expect(await people("федор")).toEqual(["Фёдор Достоевский"]);
    expect(await people("ελυτης")).toEqual(["Οδυσσέας Ελύτης"]);
    expect((await palette("ΕΛΎΤΗΣ")).people).toEqual(["Οδυσσέας Ελύτης"]);
    expect((await palette("istanbul hatirasi")).works).toEqual(["İstanbul Hatırası"]);
    expect((await palette("umit")).people).toEqual(["Ahmet Ümit"]);
    expect((await palette("pussy cat")).works).toEqual(["The Owl and the Pussy-cat"]);
  });
});
