import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
const url = process.env.DURTAL_COLLECTION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln291_test"
  )
    throw new Error("Collection tests require disposable local sln291_test");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
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
  CACHE_TAGS: {
    collections: "collections",
    works: "works",
    activity: "activity",
    media: "media",
  },
}));
vi.mock("@/lib/s3/collection-cleanup", () => ({
  cleanupCollectionArtwork: vi.fn(async () => false),
}));
import { cleanupCollectionArtwork } from "@/lib/s3/collection-cleanup";
import {
  createCollection,
  updateCollection,
  getCollection,
  getCollections,
  getCollectionCount,
  bulkAddEditionsToCollection,
  removeEditionsFromCollection,
  moveCollectionEdition,
  getCollectionSelection,
  searchEditionsForPicker,
  deleteCollection,
  getCollectionCoverPreviews,
} from "@/lib/actions/collections";

describe.skipIf(!url)("collection workflows with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate collections,works,authors,activity_events,locations cascade`,
    );
    vi.clearAllMocks();
  });
  async function book(title = "Book", number = 1) {
    const [work] = await db.insert(schema.works).values({ title }).returning();
    const editions = await db
      .insert(schema.editions)
      .values(
        Array.from({ length: number }, (_, i) => ({
          workId: work.id,
          title: `${title} ${i + 1}`,
          publisher: `Publisher ${i + 1}`,
          publicationYear: 2000 + i,
        })),
      )
      .returning();
    return { work, editions };
  }
  const members = async (id: string) =>
    (await getCollection(id))!.collectionEditions.map((e) => e.editionId);
  it("creates with a name only and preserves existing artwork when renaming", async () => {
    const c = await createCollection({ name: "  Strange tales  " });
    expect(c.name).toBe("Strange tales");
    await updateCollection(c.id, {
      posterS3Key: "existing-poster.jpg",
      backgroundS3Key: "existing-background.jpg",
    });
    await updateCollection(c.id, { name: "New name", description: "Notes" });
    expect(await getCollection(c.id)).toMatchObject({
      name: "New name",
      description: "Notes",
      posterS3Key: "existing-poster.jpg",
      backgroundS3Key: "existing-background.jpg",
    });
    await expect(updateCollection(c.id, { name: "  " })).rejects.toThrow();
    expect((await getCollection(c.id))!.name).toBe("New name");
  });
  it("creates and adds atomically; retries do not duplicate collections, members or activity", async () => {
    const b = await book("Pair", 2);
    const requestId = randomUUID();
    const ids = b.editions.map((e) => e.id);
    await createCollection({ name: "Collection" }, ids, requestId);
    await createCollection({ name: "Collection" }, ids, requestId);
    expect(await getCollections()).toHaveLength(1);
    expect(await members(requestId)).toEqual(ids);
    const events = await db.select().from(schema.activityEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityId: b.work.id,
      eventKey: "work.collection_added",
      metadata: { collectionName: "Collection" },
    });
  });
  it("rolls back collection creation if any selected edition no longer exists", async () => {
    const b = await book();
    await expect(
      createCollection({ name: "Rollback" }, [b.editions[0].id, randomUUID()]),
    ).rejects.toThrow();
    expect(await getCollections()).toHaveLength(0);
    expect(await db.select().from(schema.activityEvents)).toHaveLength(0);
  });
  it("bulk adds without changing existing order and only records real new memberships", async () => {
    const b = await book("Many", 4);
    const c = await createCollection({ name: "Collection" }, [
      b.editions[0].id,
    ]);
    expect(
      (
        await bulkAddEditionsToCollection(c.id, [
          b.editions[0].id,
          b.editions[1].id,
          b.editions[1].id,
        ])
      ).changed,
    ).toBe(1);
    expect(await members(c.id)).toEqual(
      b.editions.slice(0, 2).map((e) => e.id),
    );
    expect(
      (await bulkAddEditionsToCollection(c.id, [b.editions[0].id])).changed,
    ).toBe(0);
    expect(await db.select().from(schema.activityEvents)).toHaveLength(2);
  });
  it("serializes simultaneous additions into unique ordered positions", async () => {
    const b = await book("Concurrent", 8);
    const c = await createCollection({ name: "Collection" });
    await Promise.all(
      b.editions.map((e) => bulkAddEditionsToCollection(c.id, [e.id])),
    );
    const list = (await getCollection(c.id))!.collectionEditions;
    expect(list).toHaveLength(8);
    expect(new Set(list.map((m) => m.sortOrder)).size).toBe(8);
  });
  it("moves across the whole ordered list without dropping members, including tied legacy sort values", async () => {
    const b = await book("Ordering", 3);
    const c = await createCollection(
      { name: "Collection" },
      b.editions.map((e) => e.id),
    );
    await db
      .update(schema.collectionEditions)
      .set({ sortOrder: 0 })
      .where(eq(schema.collectionEditions.collectionId, c.id));
    const initial = await members(c.id);
    await moveCollectionEdition(c.id, initial[2], -1);
    expect(await members(c.id)).toEqual([initial[0], initial[2], initial[1]]);
    await moveCollectionEdition(c.id, initial[0], -1);
    expect(await members(c.id)).toEqual([initial[0], initial[2], initial[1]]);
    await moveCollectionEdition(c.id, initial[0], 1);
    expect(await members(c.id)).toEqual([initial[2], initial[0], initial[1]]);
  });
  it("removes membership with a named activity event, preserving editions and copies", async () => {
    const b = await book();
    const [location] = await db
      .insert(schema.locations)
      .values({ name: "Shelf", type: "physical" })
      .returning();
    const [copy] = await db
      .insert(schema.instances)
      .values({
        editionId: b.editions[0].id,
        locationId: location.id,
        notes: "User edit",
      })
      .returning();
    const c = await createCollection({ name: "Collection" }, [
      b.editions[0].id,
    ]);
    await removeEditionsFromCollection(c.id, [b.editions[0].id]);
    await removeEditionsFromCollection(c.id, [b.editions[0].id]);
    expect(await members(c.id)).toEqual([]);
    expect((await db.select().from(schema.instances))[0]).toEqual(copy);
    const events = await db.select().from(schema.activityEvents);
    expect(
      events.filter((e) => e.eventKey === "work.collection_removed"),
    ).toHaveLength(1);
  });
  it("deletes only collection membership and asks cleanup for its own artwork", async () => {
    const b = await book();
    const c = await createCollection({ name: "Delete me" }, [b.editions[0].id]);
    await updateCollection(c.id, {
      posterS3Key: `gold/media/collection/${c.id}/poster/a.webp`,
    });
    await deleteCollection(c.id);
    expect(await getCollection(c.id)).toBeUndefined();
    expect(await db.select().from(schema.works)).toHaveLength(1);
    expect((await db.select().from(schema.editions))[0]).toEqual(b.editions[0]);
    expect(cleanupCollectionArtwork).toHaveBeenCalledWith(c.id, [
      `gold/media/collection/${c.id}/poster/a.webp`,
    ]);
    expect(
      (await db.select().from(schema.activityEvents)).filter(
        (e) => e.eventKey === "work.collection_removed",
      ),
    ).toHaveLength(1);
  });
  it("reports artwork cleanup failure without misreporting the committed collection deletion", async () => {
    const c = await createCollection({ name: "Delete" });
    vi.mocked(cleanupCollectionArtwork).mockResolvedValueOnce(true);
    expect((await deleteCollection(c.id)).cleanupPending).toBe(true);
    expect(await getCollection(c.id)).toBeUndefined();
  });
  it("returns all editions for a selected work and explicitly identifies editionless works", async () => {
    const b = await book("Multiple", 2);
    const [empty] = await db
      .insert(schema.works)
      .values({ title: "No edition" })
      .returning();
    const c = await createCollection({ name: "Collection" }, [
      b.editions[0].id,
    ]);
    const selection = await getCollectionSelection([b.work.id, empty.id]);
    expect(selection.editions).toHaveLength(2);
    expect(selection.withoutEditions).toEqual([
      { id: empty.id, title: "No edition" },
    ]);
    expect(selection.collections[0].collectionEditions).toHaveLength(1);
    expect(
      (await getCollectionSelection([], [b.editions[1].id])).editions.map(
        (e) => e.id,
      ),
    ).toEqual([b.editions[1].id]);
    expect(c.id).toBe(selection.collections[0].id);
  });
  it("searches titles, accent-insensitive authors and ISBN without treating percent as a wildcard", async () => {
    const b = await book("100% Fiction", 2);
    await book("Unrelated");
    const [a] = await db
      .insert(schema.authors)
      .values({ name: "Péter Nádas" })
      .returning();
    await db
      .insert(schema.workAuthors)
      .values({ workId: b.work.id, authorId: a.id });
    await db
      .update(schema.editions)
      .set({ isbn13: "9780141183848" })
      .where(eq(schema.editions.id, b.editions[0].id));
    expect(await searchEditionsForPicker("%")).toHaveLength(2);
    expect(await searchEditionsForPicker("nadas peter")).toHaveLength(2);
    expect(await searchEditionsForPicker("9780141183848")).toHaveLength(1);
    expect(await searchEditionsForPicker("")).toHaveLength(3);
  });
  it("filters collection names literally and generates previews without needing uploaded artwork", async () => {
    const b = await book();
    await db
      .update(schema.editions)
      .set({ thumbnailS3Key: "edition-thumb.jpg" })
      .where(eq(schema.editions.id, b.editions[0].id));
    const c = await createCollection({ name: "100% Books" }, [
      b.editions[0].id,
    ]);
    await createCollection({ name: "Other" });
    expect(await getCollectionCount("%")).toBe(1);
    expect(
      await getCollections({ limit: 48, offset: 0, query: "%" }),
    ).toHaveLength(1);
    expect(await getCollectionCoverPreviews([c.id])).toEqual([
      { collectionId: c.id, s3Key: "edition-thumb.jpg" },
    ]);
  });
  it("rolls membership changes back when the paired activity write fails", async () => {
    const b = await book();
    const c = await createCollection({ name: "Collection" });
    await db.execute(
      sql`alter table activity_events add constraint collection_test_failure check(event_key <> 'work.collection_added')`,
    );
    try {
      await expect(
        bulkAddEditionsToCollection(c.id, [b.editions[0].id]),
      ).rejects.toThrow();
      expect(await members(c.id)).toHaveLength(0);
    } finally {
      await db.execute(
        sql`alter table activity_events drop constraint collection_test_failure`,
      );
    }
  });
});
