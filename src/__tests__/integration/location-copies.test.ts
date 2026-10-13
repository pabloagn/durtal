import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

/**
 * Book copies and their places: the live copy count per location (SLN-575)
 * and a sub-location that must belong to its copy's location (SLN-574).
 */
// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_LOCATION_COPIES_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln575_location_copies");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln575_location_copies"
  )
    throw new Error("Location copy tests require disposable local sln575_location_copies");
}
const client = url ? postgres(url, { prepare: false, max: 4, onnotice: () => {} }) : null;
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
// The cached locations stay warm for the whole file: counts must not depend on them
const cache = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock("@/lib/cache", () => ({
  cached: (fn: () => Promise<unknown>, keyParts: string[]) => async () => {
    const key = keyParts.join("/");
    if (!cache.store.has(key)) cache.store.set(key, await fn());
    return cache.store.get(key);
  },
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, key) => String(key) }),
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
import { getLocationCopyCounts, getLocations } from "@/lib/actions/locations";
import { createInstance, deleteInstance, updateInstance } from "@/lib/actions/instances";

describe.skipIf(!url)("book copies and their locations with PostgreSQL", () => {
  const db = testDb!;
  let editionId: string, home: string, office: string, homeShelf: string, officeShelf: string;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln575_location_copies");
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    cache.store.clear();
    await resetDisposableDatabase(url!, "sln575_location_copies", { emptyLocations: true });
    const [work] = await db.insert(schema.works).values({ title: "Là-bas", slug: "la-bas" }).returning();
    const [edition] = await db.insert(schema.editions).values({ workId: work.id, title: "Là-bas" }).returning();
    editionId = edition.id;
    [{ id: home }, { id: office }] = await db
      .insert(schema.locations)
      .values([
        { name: "Home", type: "physical", sortOrder: 0 },
        { name: "Office", type: "physical", sortOrder: 1 },
      ])
      .returning();
    [{ id: homeShelf }, { id: officeShelf }] = await db
      .insert(schema.subLocations)
      .values([
        { locationId: home, name: "Study shelf" },
        { locationId: office, name: "Desk" },
      ])
      .returning();
  }, 30000);

  const counts = async () => Object.fromEntries(await getLocationCopyCounts());
  const place = async (id: string) => {
    const [row] = await db
      .select({ locationId: schema.instances.locationId, subLocationId: schema.instances.subLocationId })
      .from(schema.instances)
      .where(eq(schema.instances.id, id));
    return row;
  };

  describe("copy counts (SLN-575)", () => {
    it("follow every add, move and delete while the cached locations stay warm", async () => {
      expect((await getLocations()).map((l) => l.name)).toEqual(["Home", "Office"]);
      expect(await counts()).toEqual({});

      const first = await createInstance({ editionId, locationId: home });
      const second = await createInstance({ editionId, locationId: home });
      expect(await counts()).toEqual({ [home]: 2 });

      await updateInstance(second.id, { locationId: office });
      expect(await counts()).toEqual({ [home]: 1, [office]: 1 });

      await deleteInstance(first.id);
      expect(await counts()).toEqual({ [office]: 1 });

      // A cascade from the edition, with no copy action at all
      await db.delete(schema.editions).where(eq(schema.editions.id, editionId));
      expect(await counts()).toEqual({});
      // The cached list was read once and never refreshed
      expect(cache.store.size).toBe(1);
    });

    it("leave a failed write out of the count", async () => {
      await createInstance({ editionId, locationId: home });
      await expect(createInstance({ editionId, locationId: home, subLocationId: officeShelf })).rejects.toThrow();
      expect(await counts()).toEqual({ [home]: 1 });
    });
  });

  describe("sub-locations (SLN-574)", () => {
    it("refuses a new copy on a sub-location of another location, and keeps a fitting one", async () => {
      await expect(
        createInstance({ editionId, locationId: home, subLocationId: officeShelf }),
      ).rejects.toThrow("The sub-location belongs to another location");
      expect(await db.select().from(schema.instances)).toEqual([]);

      const copy = await createInstance({ editionId, locationId: office, subLocationId: officeShelf });
      expect(await place(copy.id)).toEqual({ locationId: office, subLocationId: officeShelf });
      const loose = await createInstance({ editionId, locationId: home });
      expect(await place(loose.id)).toEqual({ locationId: home, subLocationId: null });
    });

    it("refuses an edit that names a sub-location of another location, and changes nothing", async () => {
      const copy = await createInstance({ editionId, locationId: office, subLocationId: officeShelf });
      await expect(updateInstance(copy.id, { locationId: home, subLocationId: officeShelf })).rejects.toThrow(
        "The sub-location belongs to another location",
      );
      await expect(updateInstance(copy.id, { subLocationId: homeShelf })).rejects.toThrow(
        "The sub-location belongs to another location",
      );
      expect(await place(copy.id)).toEqual({ locationId: office, subLocationId: officeShelf });
    });

    it("takes a moved copy off its old sub-location when the move names none", async () => {
      const copy = await createInstance({ editionId, locationId: office, subLocationId: officeShelf });
      await updateInstance(copy.id, { locationId: home });
      expect(await place(copy.id)).toEqual({ locationId: home, subLocationId: null });

      await updateInstance(copy.id, { locationId: home, subLocationId: homeShelf });
      expect(await place(copy.id)).toEqual({ locationId: home, subLocationId: homeShelf });
      // Staying put, or changing something else, keeps it
      await updateInstance(copy.id, { locationId: home, condition: "fine" });
      await updateInstance(copy.id, { status: "lent_out" });
      expect(await place(copy.id)).toEqual({ locationId: home, subLocationId: homeShelf });
      // And clearing it on purpose clears it
      await updateInstance(copy.id, { subLocationId: null });
      expect(await place(copy.id)).toEqual({ locationId: home, subLocationId: null });
    });
  });
});
