import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_PUBLISHER_BOOKS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln427_test")
    throw new Error("Publisher page tests require disposable local sln427_test");
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
vi.mock("@/lib/cache", () => ({ cached: (fn: unknown) => fn, invalidate: vi.fn(), CACHE_TAGS: {} }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { savePublisher } from "@/lib/actions/publishers";
import {
  getPublisherBookFacets,
  getPublisherBooks,
  getPublisherCounts,
  getPublisherImages,
  parsePublisherBookQuery,
} from "@/lib/publishers/books";
import { supportsMediaType } from "@/lib/media/owner";

describe("publisher page query parameters", () => {
  it("reads filters, keeps the old tabs and drops unknown values", () => {
    expect(parsePublisherBookQuery({ filter: "owned" }).state).toEqual(["owned"]);
    expect(parsePublisherBookQuery({ filter: "all" }).state).toEqual([]);
    const q = parsePublisherBookQuery({
      state: "wanted,stolen",
      mark: "rare",
      language: "es,english",
      yearMin: "1960",
      yearMax: "x",
      author: "not-a-uuid",
      sort: "year",
    });
    expect(q).toMatchObject({ state: ["wanted"], marks: ["rare"], languages: ["es"], yearMin: 1960, yearMax: undefined, authors: [], sort: "year", order: "desc" });
    expect(parsePublisherBookQuery({ sort: "price" })).toMatchObject({ sort: "title", order: "asc", perPage: 24 });
  });
  it("lets a publishing house have a background, but not an object or a bottle", () => {
    expect(supportsMediaType("organization", "background")).toBe(true);
    expect(supportsMediaType("art_object", "background")).toBe(false);
    expect(supportsMediaType("perfume_variant", "background")).toBe(false);
  });
});

describe.skipIf(!url)("a publishing house's books as a catalogue", () => {
  const db = testDb!;
  let house: string, imprint: string, other: string, location: string;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate works, authors, publishing_houses, locations, media cascade`);
    house = (await savePublisher({ name: "New York Review Books", country: "United States" }))!.id;
    imprint = (await savePublisher({ name: "NYRB Poets", kind: "imprint", parentId: house }))!.id;
    other = (await savePublisher({ name: "Penguin" }))!.id;
    [{ id: location }] = await db.insert(schema.locations).values({ name: "Study", type: "physical" }).returning();
  });

  async function book(
    title: string,
    author: string,
    editions: { publisher: string; year?: number; language?: string; binding?: string; cover?: string; owned?: boolean }[],
    work: Partial<typeof schema.works.$inferInsert> = {},
  ) {
    const [w] = await db.insert(schema.works).values({ title, slug: title.toLowerCase().replace(/\W+/g, "-"), catalogueStatus: "tracked", ...work }).returning();
    const [a] = await db.insert(schema.authors).values({ name: author, slug: author.toLowerCase().replace(/\W+/g, "-") }).onConflictDoNothing().returning();
    const authorId = a?.id ?? (await db.execute(sql`select id from authors where name = ${author}`)).at(0)!.id as string;
    await db.insert(schema.workAuthors).values({ workId: w.id, authorId });
    const ids = [];
    for (const e of editions) {
      const [row] = await db
        .insert(schema.editions)
        .values({ workId: w.id, title, publicationYear: e.year, language: e.language ?? "en", binding: e.binding, thumbnailS3Key: e.cover })
        .returning();
      await db.insert(schema.editionPublishers).values({ editionId: row.id, publisherId: e.publisher });
      if (e.owned) await db.insert(schema.instances).values({ editionId: row.id, locationId: location });
      ids.push(row.id);
    }
    return { work: w, editions: ids };
  }
  const run = (raw: Record<string, string> = {}) => getPublisherBooks(house, parsePublisherBookQuery(raw));

  it("shows one card per book, from the house and its imprints, with this house's edition cover", async () => {
    const stoner = await book("Stoner", "John Williams", [
      { publisher: other, year: 1965, cover: "penguin.webp" },
      { publisher: house, year: 2006, cover: "nyrb.webp" },
    ]);
    await book("Poems", "Osip Mandelstam", [{ publisher: imprint, year: 2010 }]);
    await book("Elsewhere", "Nobody", [{ publisher: other, year: 2000 }]);
    const { books, total } = await run();
    expect(total).toBe(2);
    expect(books.map((b) => b.title)).toEqual(["Poems", "Stoner"]);
    const card = books.find((b) => b.title === "Stoner")!;
    expect(card).toMatchObject({ primaryEditionId: stoner.editions[1], publicationYear: 2006, coverUrl: "/api/s3/read?key=nyrb.webp", authorName: "John Williams" });
    // An imprint's page lists only its own books
    expect((await getPublisherBooks(imprint, parsePublisherBookQuery({}))).total).toBe(1);
  });

  it("prefers the owned edition, and filters by owned, wanted and on order", async () => {
    const twice = await book("The Dud Avocado", "Elaine Dundy", [
      { publisher: house, year: 2007 },
      { publisher: house, year: 2018, owned: true },
    ]);
    await book("Wanted Book", "A Writer", [{ publisher: house, year: 2001 }], { catalogueStatus: "wanted" });
    expect((await run()).books.find((b) => b.title === "The Dud Avocado")).toMatchObject({ primaryEditionId: twice.editions[1], instanceCount: 1 });
    expect((await run({ state: "owned" })).books.map((b) => b.title)).toEqual(["The Dud Avocado"]);
    expect((await run({ state: "wanted" })).books.map((b) => b.title)).toEqual(["Wanted Book"]);
    expect((await run({ state: "on_order" })).total).toBe(0);
    expect((await run({ state: "owned,wanted" })).total).toBe(2);
    expect(await getPublisherCounts(house)).toEqual({ books: 2, editions: 3, owned: 1, wanted: 1, onOrder: 0 });
  });

  it("searches and filters by mark, language, binding, years, author and imprint", async () => {
    await book("Stoner", "John Williams", [{ publisher: house, year: 2006, binding: "paperback" }], { isRare: true, huntAssessedOn: "2026-10-01" });
    await book("Augustus", "John Williams", [{ publisher: house, year: 2014, language: "es", binding: "hardcover" }]);
    await book("Poems", "Osip Mandelstam", [{ publisher: imprint, year: 1975 }]);
    expect((await run({ q: "augus" })).books.map((b) => b.title)).toEqual(["Augustus"]);
    expect((await run({ q: "mandel" })).books.map((b) => b.title)).toEqual(["Poems"]);
    expect((await run({ q: "100%" })).total).toBe(0);
    expect((await run({ mark: "rare" })).books.map((b) => b.title)).toEqual(["Stoner"]);
    expect((await run({ language: "es" })).books.map((b) => b.title)).toEqual(["Augustus"]);
    expect((await run({ binding: "paperback" })).books.map((b) => b.title)).toEqual(["Stoner"]);
    expect((await run({ yearMin: "2000", yearMax: "2010" })).books.map((b) => b.title)).toEqual(["Stoner"]);
    expect((await run({ imprint })).books.map((b) => b.title)).toEqual(["Poems"]);
    const facets = await getPublisherBookFacets(house);
    const williams = facets.authors.find((a) => a.name === "John Williams")!;
    expect(williams.count).toBe(2);
    expect((await run({ author: williams.id })).total).toBe(2);
    expect(facets).toMatchObject({
      languages: [{ value: "en", count: 2 }, { value: "es", count: 1 }],
      bindings: [{ value: "hardcover", count: 1 }, { value: "paperback", count: 1 }],
      years: { min: 1975, max: 2014 },
      imprints: [{ id: imprint, name: "NYRB Poets", count: 1 }],
    });
  });

  it("sorts and pages on the server", async () => {
    for (let i = 0; i < 30; i++) await book(`Book ${String(i).padStart(2, "0")}`, `Author ${i}`, [{ publisher: house, year: 1950 + i }]);
    const first = await run({ perPage: "24" });
    const second = await run({ perPage: "24", page: "2" });
    expect(first.total).toBe(30);
    expect(first.books).toHaveLength(24);
    expect(second.books.map((b) => b.title)).toEqual(["Book 24", "Book 25", "Book 26", "Book 27", "Book 28", "Book 29"]);
    expect((await run({ sort: "year" })).books[0].title).toBe("Book 29");
    expect((await run({ sort: "year", order: "asc" })).books[0].title).toBe("Book 00");
    expect((await run({ sort: "title", order: "desc" })).books[0].title).toBe("Book 29");
  });

  it("finds the house's active logo and background", async () => {
    await db.insert(schema.media).values([
      { organizationId: house, type: "poster", s3Key: "logo.webp", isActive: true },
      { organizationId: house, type: "background", s3Key: "banner.webp", isActive: true },
    ]);
    const images = await getPublisherImages(house);
    // The background row is allowed by the new media_type_check (0053)
    expect([images.logo?.s3Key, images.background?.s3Key]).toEqual(["logo.webp", "banner.webp"]);
  });
});
