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
  bulkAddWorksToCollection,
  removeWorksFromCollection,
  moveCollectionMember,
  getCollectionsForWork,
  searchWorksForCollection,
} from "@/lib/actions/collections";
import { collectionCounts } from "@/lib/collections/counts";
import { shownMembers } from "@/lib/collections/members";

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
  /** A film, perfume, painting or a book with no edition */
  async function work(title: string, kind: "book" | "film" | "perfume" | "painting") {
    const [row] = await db
      .insert(schema.works)
      .values({ title, kind, originalLanguage: kind === "book" ? "en" : null })
      .returning();
    return row;
  }
  /** The members the page shows, in order, as [kind, id] */
  async function shown(id: string) {
    const rows = await db.execute(shownMembers(id));
    return (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows).map(
      (r) => [(r as { kind: string }).kind, (r as { id: string }).id],
    );
  }
  it("creates with a name only and preserves existing artwork when renaming", async () => {
    const c = await createCollection({ name: "  Strange tales  " });
    expect(c.name).toBe("Strange tales");
    await db.insert(schema.media).values([
      { collectionId: c.id, type: "poster", s3Key: "existing-poster.jpg" },
      { collectionId: c.id, type: "background", s3Key: "existing-background.jpg" },
    ]);
    await updateCollection(c.id, { name: "New name", description: "Notes" });
    const saved = await getCollection(c.id);
    expect(saved).toMatchObject({ name: "New name", description: "Notes" });
    expect(saved!.media.map((m) => [m.type, m.s3Key]).sort()).toEqual([
      ["background", "existing-background.jpg"],
      ["poster", "existing-poster.jpg"],
    ]);
    // Artwork is not a collection field any more.
    await expect(
      updateCollection(c.id, { posterS3Key: "x.jpg" } as never),
    ).rejects.toThrow();
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
    await db.insert(schema.media).values({
      collectionId: c.id,
      type: "poster",
      s3Key: `gold/media/collection/${c.id}/poster/a.webp`,
    });
    const [bookPoster] = await db
      .insert(schema.media)
      .values({ workId: b.work.id, type: "poster", s3Key: "book-poster.webp" })
      .returning();
    await deleteCollection(c.id);
    expect(await getCollection(c.id)).toBeUndefined();
    expect(await db.select().from(schema.works)).toHaveLength(1);
    expect((await db.select().from(schema.editions))[0]).toEqual(b.editions[0]);
    // Collection media rows go with it; the book's own poster stays.
    expect(await db.select().from(schema.media)).toEqual([bookPoster]);
    // The cleanup sweeps the collection's own S3 namespace.
    expect(cleanupCollectionArtwork).toHaveBeenCalledWith(c.id, []);
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
    // A book with no edition joins as a whole book, never a placeholder edition
    expect(selection.works).toEqual([
      { id: empty.id, title: "No edition", kind: "book" },
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
  it("collects a painting, a perfume, a film and a book edition in one order, kept across reloads", async () => {
    const b = await book("Against Nature", 2);
    const film = await work("Le Samouraï", "film");
    const perfume = await work("Shalimar", "perfume");
    const painting = await work("The Night Watch", "painting");
    const c = await createCollection({ name: "Mixed" }, [b.editions[1].id]);
    expect(
      await bulkAddWorksToCollection(c.id, [painting.id, perfume.id, film.id]),
    ).toEqual({ changed: 3 });
    // Adding again changes nothing
    expect(await bulkAddWorksToCollection(c.id, [film.id])).toEqual({ changed: 0 });
    expect(await shown(c.id)).toEqual([
      ["edition", b.editions[1].id],
      ["work", painting.id],
      ["work", perfume.id],
      ["work", film.id],
    ]);
    await moveCollectionMember(c.id, { kind: "work", id: film.id }, -1);
    await moveCollectionMember(c.id, { kind: "work", id: film.id }, -1);
    await moveCollectionMember(c.id, { kind: "edition", id: b.editions[1].id }, 1);
    const order = [
      ["work", film.id],
      ["edition", b.editions[1].id],
      ["work", painting.id],
      ["work", perfume.id],
    ];
    expect(await shown(c.id)).toEqual(order);
    // A reload reads the same order from both tables
    const saved = (await getCollection(c.id))!;
    const rows = [
      ...saved.collectionEditions.map((m) => [m.sortOrder, "edition", m.editionId]),
      ...saved.collectionWorks.map((m) => [m.sortOrder, "work", m.workId]),
    ].sort((x, y) => Number(x[0]) - Number(y[0]));
    expect(rows.map(([, kind, id]) => [kind, id])).toEqual(order);
    expect(collectionCounts(saved)).toEqual({ editionCount: 1, workCount: 3 });
    expect(
      (await getCollections()).map((x) => collectionCounts(x)),
    ).toEqual([{ editionCount: 1, workCount: 3 }]);
    // An older move API still moves an edition within the one order
    await moveCollectionEdition(c.id, b.editions[1].id, -1);
    expect((await shown(c.id))[0]).toEqual(["edition", b.editions[1].id]);
  });

  it("shows a book collected both ways once, through its chosen edition", async () => {
    const b = await book("Là-bas", 2);
    const other = await book("En route", 1);
    const c = await createCollection({ name: "Durtal" }, [b.editions[0].id]);
    await bulkAddWorksToCollection(c.id, [b.work.id, other.work.id]);
    // The edition stands for its book; the other book shows whole
    expect(await shown(c.id)).toEqual([
      ["edition", b.editions[0].id],
      ["work", other.work.id],
    ]);
    const saved = (await getCollection(c.id))!;
    expect(collectionCounts(saved)).toEqual({ editionCount: 1, workCount: 1 });
    // The edition choice is never collapsed into the book
    expect(saved.collectionEditions.map((m) => m.editionId)).toEqual([b.editions[0].id]);
    const [held] = await getCollectionsForWork(b.work.id);
    expect(held).toMatchObject({ holdsWork: true, heldEditions: [{ editionId: b.editions[0].id }] });
    // Removing the edition leaves the whole book, which then shows
    await removeEditionsFromCollection(c.id, [b.editions[0].id]);
    expect((await shown(c.id)).map(([kind, id]) => `${kind}:${id}`).sort()).toEqual(
      [`work:${b.work.id}`, `work:${other.work.id}`].sort(),
    );
    // Previews take a whole book's poster when no edition stands for it
    await db.insert(schema.media).values({ workId: other.work.id, type: "poster", s3Key: "en-route.jpg", isActive: true });
    expect(await getCollectionCoverPreviews([c.id])).toEqual([
      { collectionId: c.id, s3Key: "en-route.jpg" },
    ]);
  });

  it("removes whole works, drops them with a deleted work, and records the activity", async () => {
    const film = await work("Persona", "film");
    const painting = await work("Saturn", "painting");
    const c = await createCollection({ name: "Bergman" }, [], undefined, [film.id, painting.id]);
    expect(collectionCounts((await getCollection(c.id))!)).toEqual({ editionCount: 0, workCount: 2 });
    expect(await removeWorksFromCollection(c.id, [film.id])).toEqual({ changed: 1 });
    await db.delete(schema.works).where(eq(schema.works.id, painting.id));
    expect((await getCollection(c.id))!.collectionWorks).toEqual([]);
    const events = await db.select().from(schema.activityEvents);
    expect(events.map((e) => [e.entityId, e.eventKey]).sort()).toEqual(
      [
        [film.id, "work.collection_added"],
        [painting.id, "work.collection_added"],
        [film.id, "work.collection_removed"],
      ].sort(),
    );
    const again = await createCollection({ name: "Again" }, [], undefined, [film.id]);
    await deleteCollection(again.id);
    expect(
      (await db.select().from(schema.activityEvents)).filter(
        (e) => e.entityId === film.id && e.eventKey === "work.collection_removed",
      ),
    ).toHaveLength(2);
  });

  it("selects any open kind of work as a whole work and finds works by title", async () => {
    const film = await work("The Thing", "film");
    const selection = await getCollectionSelection([film.id]);
    expect(selection.editions).toEqual([]);
    expect(selection.works).toEqual([{ id: film.id, title: "The Thing", kind: "film" }]);
    expect((await searchWorksForCollection("thing", "film")).map((w) => w.workId)).toEqual([film.id]);
    expect(await searchWorksForCollection("thing", "perfume")).toEqual([]);
  });
});
