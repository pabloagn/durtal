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
const url = process.env.DURTAL_FAVOURITES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln426_test"
  )
    throw new Error("Favourite tests require disposable local sln426_test");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
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
import { setFavourite, setFavourites } from "@/lib/actions/favourites";
import { getWorks, getWorkCount } from "@/lib/actions/works";
import { getAuthors, getAuthorCount } from "@/lib/actions/authors";
import { getCollections, getCollectionCount } from "@/lib/actions/collections";
import { getSeriesList } from "@/lib/actions/series";
import { getRecommenderList } from "@/lib/actions/recommenders";
import { getVenues, getVenueCount } from "@/lib/actions/venues";
import { recordActivity } from "@/lib/activity/record";

describe.skipIf(!url)("favourites with PostgreSQL", () => {
  const db = testDb!;
  const works: Record<string, string> = {};
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate works, authors, collections, series, recommenders, venues, publishing_houses cascade`,
    );
    vi.clearAllMocks();
    for (const title of ["Maldoror", "Crash", "Fictions"]) {
      const [w] = await db
        .insert(schema.works)
        .values({ title, originalYear: 1900 })
        .returning();
      works[title] = w.id;
    }
  });

  it("stars works in bulk, writes and logs only the rows that change", async () => {
    expect(
      await setFavourites({
        entity: "work",
        ids: [works.Maldoror, works.Crash],
        favourite: true,
      }),
    ).toEqual({ updated: 2 });
    expect(
      await setFavourites({
        entity: "work",
        ids: [works.Maldoror, works.Fictions],
        favourite: true,
      }),
    ).toEqual({ updated: 1 });
    expect(recordActivity).toHaveBeenCalledTimes(3);
    expect(recordActivity).toHaveBeenCalledWith(
      "work",
      works.Fictions,
      "work.favourite_changed",
      { newValue: "favourite" },
    );
    await setFavourite("work", works.Crash, false);
    expect(recordActivity).toHaveBeenLastCalledWith(
      "work",
      works.Crash,
      "work.favourite_changed",
      { newValue: null },
    );
    const titles = (await getWorks({ filters: { marks: ["favourite"] } })).map(
      (w) => w.title,
    );
    expect(titles.sort()).toEqual(["Fictions", "Maldoror"]);
    expect(await getWorkCount(undefined, { marks: ["favourite"] })).toBe(2);
  });

  it("filters people, collections, series and recommenders by their star", async () => {
    const [kafka, borges] = await db
      .insert(schema.authors)
      .values([{ name: "Franz Kafka" }, { name: "Jorge Luis Borges" }])
      .returning();
    // A new person joins the book domain on insert (database default)
    await db
      .insert(schema.personDomains)
      .values([
        { personId: kafka.id, kind: "book" },
        { personId: borges.id, kind: "book" },
      ])
      .onConflictDoNothing();
    const [shelf, other] = await db
      .insert(schema.collections)
      .values([{ name: "Night shelf" }, { name: "Other" }])
      .returning();
    const [cycle] = await db
      .insert(schema.series)
      .values([
        { title: "Cycle", slug: "cycle" },
        { title: "Saga", slug: "saga" },
      ])
      .returning();
    const [critic] = await db
      .insert(schema.recommenders)
      .values([{ name: "A critic" }, { name: "A friend" }])
      .returning();

    await setFavourite("author", kafka.id, true);
    await setFavourite("collection", shelf.id, true);
    await setFavourite("series", cycle.id, true);
    await setFavourite("recommender", critic.id, true);
    expect(recordActivity).toHaveBeenCalledWith(
      "author",
      kafka.id,
      "author.favourite_changed",
      { newValue: "favourite" },
    );
    expect(recordActivity).toHaveBeenCalledTimes(1);

    const people = await getAuthors({ filters: { favourites: true } });
    expect(people.map((a) => a.name)).toEqual(["Franz Kafka"]);
    expect(await getAuthorCount({ filters: { favourites: true } })).toBe(1);
    expect(await getAuthorCount({})).toBe(2);

    const shelves = await getCollections({ limit: 10, offset: 0, favourites: true });
    expect(shelves.map((c) => c.id)).toEqual([shelf.id]);
    expect(await getCollectionCount("", true)).toBe(1);
    expect(await getCollectionCount("")).toBe(2);
    expect(other.isFavourite).toBe(false);

    const seriesList = await getSeriesList({ favourites: true });
    expect(seriesList.rows.map((s) => [s.title, s.isFavourite])).toEqual([["Cycle", true]]);
    expect(seriesList.total).toBe(1);

    const critics = await getRecommenderList({ favourites: true });
    expect(critics.rows.map((r) => r.name)).toEqual(["A critic"]);
    expect(critics.total).toBe(1);
  });

  it("keeps the places' own column and filter", async () => {
    const [shop] = await db
      .insert(schema.venues)
      .values([
        { name: "Shop", type: "bookshop" },
        { name: "Cafe", type: "cafe" },
      ])
      .returning();
    await setFavourite("venue", shop.id, true);
    const [row] = await db
      .select({ isFavorite: schema.venues.isFavorite })
      .from(schema.venues)
      .where(eq(schema.venues.id, shop.id));
    expect(row.isFavorite).toBe(true);
    const starred = await getVenues({ filters: { favorite: true } });
    expect(starred.map((v) => v.name)).toEqual(["Shop"]);
    expect(await getVenueCount({ filters: { favorite: true } })).toBe(1);
  });

  it("keeps publishers to publishing houses, and organizations to any house", async () => {
    const [house, museum] = await db
      .insert(schema.publishingHouses)
      .values([
        { name: "Gallimard", slug: "gallimard", kind: "publisher" },
        { name: "Prado", slug: "prado", kind: null },
      ])
      .returning();
    await setFavourite("publisher", house.id, true);
    await expect(setFavourite("publisher", museum.id, true)).rejects.toThrow(
      "Publisher not found",
    );
    await setFavourite("organization", museum.id, true);
    const rows = await db
      .select({ id: schema.publishingHouses.id, fav: schema.publishingHouses.isFavourite })
      .from(schema.publishingHouses);
    expect(rows.every((r) => r.fav)).toBe(true);
  });

  it("rejects bad input and unknown items", async () => {
    await expect(
      setFavourites({ entity: "work", ids: ["not-a-uuid"], favourite: true }),
    ).rejects.toThrow();
    await expect(
      setFavourites({ entity: "edition" as never, ids: [works.Crash], favourite: true }),
    ).rejects.toThrow();
    await expect(
      setFavourite("series", "00000000-0000-4000-8000-000000000000", true),
    ).rejects.toThrow("Series not found");
    // Already starred: no change, no error, nothing logged
    await setFavourite("work", works.Crash, true);
    vi.clearAllMocks();
    await expect(setFavourite("work", works.Crash, true)).resolves.toEqual({
      updated: 0,
    });
    expect(recordActivity).not.toHaveBeenCalled();
  });
});
