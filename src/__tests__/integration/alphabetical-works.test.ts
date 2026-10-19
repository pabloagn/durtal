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
import * as schema from "@/lib/db/schema";
import { paginateItems } from "@/lib/utils/pagination";

// Never load a live environment file. This suite only writes to its local DB.
const url = process.env.DURTAL_TITLE_ORDER_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln344_test");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln344_test"
  ) {
    throw new Error("Title-order tests require disposable local sln344_test");
  }
}
const client = url ? postgres(url, { prepare: false, max: 4, onnotice: () => {} }) : null;
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
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { getAuthor, getAuthorBySlug, getPersonBookCards, getPersonBooks } from "@/lib/actions/authors";
import {
  getWorks,
  getWorksByAuthorId,
  getWorksWithMark,
  getLibraryStats,
} from "@/lib/actions/works";
import { getRecommender } from "@/lib/actions/recommenders";
import { getPublisherCatalogue } from "@/lib/actions/publishers";

describe.skipIf(!url)("alphabetical browsing with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln344_test");
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln344_test");
  }, 30000);
  async function book(
    title: string,
    extra: Partial<typeof schema.works.$inferInsert> = {},
  ) {
    const [w] = await db
      .insert(schema.works)
      .values({ title, ...extra })
      .returning();
    return w;
  }
  async function volumes() {
    // Reverse insertion order and contributor order must not affect title order.
    const [author] = await db
      .insert(schema.authors)
      .values({ name: "Solvej Balle", slug: "solvej-balle" })
      .returning();
    const books = [];
    for (let n = 30; n > 0; n--) {
      const w = await book(`Volume: ${n}`, {
        isRare: true,
        huntAssessedOn: "2026-09-29",
        catalogueStatus: "wanted",
      });
      books.push(w);
      await db
        .insert(schema.workAuthors)
        .values({ authorId: author.id, workId: w.id, sortOrder: 30 - n });
    }
    return { author, books };
  }
  const titles = (books: { title: string }[]) => books.map((w) => w.title);

  it("sorts all author works before pagination through both author lookups", async () => {
    const { author } = await volumes();
    // The person page's books (SLN-1078), and the API's record of the person
    const lists: { title: string }[][] = [
      await getPersonBooks(author.slug!),
      (await getAuthor(author.id))!.workAuthors.map((wa) => wa.work),
    ];
    for (const works of lists) {
      expect(titles(works)).toEqual(
        Array.from({ length: 30 }, (_, i) => `Volume: ${i + 1}`),
      );
      expect(
        paginateItems(works, { page: "2", perPage: "24" }).items[0].title,
      ).toBe("Volume: 25");
    }
    expect(await getAuthorBySlug("missing")).toBeUndefined();
  });

  it("builds a person's book cards for one page only, as the library does (SLN-1078)", async () => {
    const { author, books } = await volumes();
    const [first, second] = [books.at(-1)!, books.at(-2)!];
    expect([first.title, second.title]).toEqual(["Volume: 1", "Volume: 2"]);
    // The oldest edition is the card's, whatever was added since
    const [oldest] = await db.insert(schema.editions).values({ workId: first.id, title: "First", createdAt: new Date("2001-01-01") }).returning();
    await db.insert(schema.editions).values({ workId: first.id, title: "Later", createdAt: new Date("2020-01-01") });
    // Only the active poster leaves the database, never the gallery
    await db.insert(schema.media).values([
      { workId: first.id, type: "gallery", isActive: false, s3Key: "gallery.webp" },
      { workId: first.id, type: "poster", isActive: false, s3Key: "old.webp" },
      { workId: first.id, type: "poster", isActive: true, s3Key: "poster.webp" },
      { authorId: author.id, type: "gallery", isActive: false, s3Key: "portrait-gallery.webp" },
      { authorId: author.id, type: "poster", isActive: true, s3Key: "portrait.webp" },
    ]);
    const cards = await getPersonBookCards([second.id, first.id]);
    expect(cards.map((card) => card.title)).toEqual(["Volume: 2", "Volume: 1"]);
    const card = cards[1];
    expect(card.editions.map((edition) => edition.id)).toEqual([oldest.id]);
    expect(card.media.map((m) => m.s3Key)).toEqual(["poster.webp"]);
    expect(card.workAuthors.map((wa) => wa.author.name)).toEqual(["Solvej Balle"]);
    expect(card).not.toHaveProperty("description");
    // The person's own images: the portrait, not the gallery
    expect((await getAuthorBySlug(author.slug!))!.media.map((m) => m.s3Key)).toEqual(["portrait.webp"]);
  });

  it("defaults the library to title order across pages, retaining filters and descending title", async () => {
    await volumes();
    await book("A filtered-out work");
    const filters = { isRare: true };
    expect(titles(await getWorks({ filters, limit: 2 }))).toEqual([
      "Volume: 1",
      "Volume: 2",
    ]);
    expect(titles(await getWorks({ filters, limit: 2, offset: 2 }))).toEqual([
      "Volume: 3",
      "Volume: 4",
    ]);
    expect(
      titles(
        await getWorks({
          filters,
          sort: "title",
          order: "desc",
          limit: 2,
          offset: 1,
        }),
      ),
    ).toEqual(["Volume: 29", "Volume: 28"]);
    expect(await getWorks({ filters, offset: 50 })).toEqual([]);
  });

  it("keeps explicit recent, year, and rating sorts", async () => {
    await book("Alpha", {
      createdAt: new Date("2020-01-01"),
      originalYear: 1900,
      rating: 1,
    });
    await book("Zulu", {
      createdAt: new Date("2026-01-01"),
      originalYear: 2000,
      rating: 5,
    });
    for (const sort of ["recent", "year", "rating"] as const) {
      expect(titles(await getWorks({ sort, limit: 1 }))).toEqual(["Zulu"]);
    }
  });

  it("uses stable IDs for equal titles at page boundaries", async () => {
    const high = "00000000-0000-4000-8000-000000000002";
    const low = "00000000-0000-4000-8000-000000000001";
    await book("ÉTÉ", { id: high });
    await book("ete", { id: low });
    expect((await getWorks({ limit: 1 }))[0].id).toBe(low);
    expect((await getWorks({ limit: 1, offset: 1 }))[0].id).toBe(high);
  });

  it("limits More by and mark rows after ordering, excluding the current book", async () => {
    const { author, books } = await volumes();
    const current = books.find((w) => w.title === "Volume: 1")!;
    expect(titles(await getWorksByAuthorId(author.id, current.id, 2))).toEqual([
      "Volume: 2",
      "Volume: 3",
    ]);
    expect(titles(await getWorksWithMark("rare", current.id, 2))).toEqual([
      "Volume: 2",
      "Volume: 3",
    ]);
    expect(await getWorksWithMark("poison", current.id)).toEqual([]);
    expect(titles((await getLibraryStats()).wantedWorks)).toEqual(
      Array.from({ length: 8 }, (_, i) => `Volume: ${i + 1}`),
    );
  });

  it("sorts recommended works naturally with accent and case insensitive ordering", async () => {
    const [r] = await db
      .insert(schema.recommenders)
      .values({ name: "Reader" })
      .returning();
    for (const title of [
      "Zulu",
      "Volume: 10",
      "Volume: 2",
      "Éclair",
      "apple",
    ]) {
      const w = await book(title);
      await db
        .insert(schema.workRecommenders)
        .values({ workId: w.id, recommenderId: r.id });
    }
    expect(titles((await getRecommender(r.id))!.books)).toEqual([
      "apple",
      "Éclair",
      "Volume: 2",
      "Volume: 10",
      "Zulu",
    ]);
  });

  it("paginates publishers in title order and keeps all editions of each work together", async () => {
    const { books } = await volumes();
    const [publisher] = await db
      .insert(schema.publishingHouses)
      .values({ name: "Press", slug: "press" })
      .returning();
    for (const work of books) {
      const editions = await db
        .insert(schema.editions)
        .values([
          { workId: work.id, title: work.title, publicationYear: 2020 },
          { workId: work.id, title: work.title, publicationYear: 2024 },
        ])
        .returning();
      await db
        .insert(schema.editionPublishers)
        .values(
          editions.map((e) => ({ editionId: e.id, publisherId: publisher.id })),
        );
    }
    const first = await getPublisherCatalogue(publisher.id, "all", 1, 24);
    const second = await getPublisherCatalogue(publisher.id, "all", 2, 24);
    expect(first.totals.works).toBe(30);
    expect(first.rows).toHaveLength(48);
    expect(first.rows.at(-1)!.work.title).toBe("Volume: 24");
    expect(second.rows[0].work.title).toBe("Volume: 25");
    expect(second.rows).toHaveLength(12);
  });
});
