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
const url = process.env.DURTAL_COLLECTION_MEDIA_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln326_test"
  )
    throw new Error(
      "Collection media tests require disposable local sln326_test",
    );
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
vi.mock("@/lib/s3", () => ({ deleteFromS3: vi.fn(async () => undefined) }));
vi.mock("@/lib/s3/cleanup", async (original) => ({
  ...(await original<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
vi.mock("@/lib/s3/media", () => ({
  renderImage: vi.fn(async () => ({
    full: Buffer.from("full"),
    thumb: Buffer.from("thumb"),
    original: null,
    width: 800,
    height: 1200,
  })),
  renderAuthorImage: vi.fn(),
}));
vi.mock("@/lib/s3/covers", () => ({ uploadToS3: vi.fn(async () => undefined) }));
vi.mock("@/lib/color/extract-palette", () => ({
  extractColorPalette: vi.fn(async () => null),
}));
import { recordActivity } from "@/lib/activity/record";
import { renderImage } from "@/lib/s3/media";
import {
  createMedia,
  deleteMedia,
  getMediaByType,
  setActiveMedia,
} from "@/lib/actions/media";
import {
  getCollection,
  getCollections,
  getCollectionsForWork,
} from "@/lib/actions/collections";
import { POST as upload } from "@/app/api/media/upload/route";

describe.skipIf(!url)("collection media with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate collections, works, authors cascade`);
    vi.clearAllMocks();
  });
  async function collection(name: string, sortOrder = 0) {
    return (
      await db
        .insert(schema.collections)
        .values({ name, sortOrder })
        .returning()
    )[0];
  }
  async function book(title: string, editions = 1) {
    const [work] = await db.insert(schema.works).values({ title }).returning();
    const rows = await db
      .insert(schema.editions)
      .values(
        Array.from({ length: editions }, (_, i) => ({
          workId: work.id,
          title: `${title} ${i + 1}`,
          publicationYear: 2000 + i,
        })),
      )
      .returning();
    return { work, editions: rows };
  }
  async function member(
    collectionId: string,
    editionId: string,
    sortOrder = 0,
  ) {
    await db
      .insert(schema.collectionEditions)
      .values({ collectionId, editionId, sortOrder });
  }

  it("activates one poster per collection without touching other owners", async () => {
    const a = await collection("A");
    const b = await collection("B");
    const { work } = await book("Book");
    const bookPoster = await createMedia({
      workId: work.id,
      type: "poster",
      s3Key: "book.webp",
    });
    const first = await createMedia({
      collectionId: a.id,
      type: "poster",
      s3Key: "a1.webp",
    });
    const second = await createMedia({
      collectionId: a.id,
      type: "poster",
      s3Key: "a2.webp",
    });
    const other = await createMedia({
      collectionId: b.id,
      type: "poster",
      s3Key: "b1.webp",
    });
    const background = await createMedia({
      collectionId: a.id,
      type: "background",
      s3Key: "a-bg.webp",
    });
    await setActiveMedia(second.id);
    const read = async (id: string) =>
      (await db.select().from(schema.media).where(eq(schema.media.id, id)))[0]
        .isActive;
    expect(await read(first.id)).toBe(false);
    expect(await read(second.id)).toBe(true);
    expect(await read(other.id)).toBe(true);
    expect(await read(background.id)).toBe(true);
    expect(await read(bookPoster.id)).toBe(true);
    // Collections have no activity timeline.
    expect(
      vi.mocked(recordActivity).mock.calls.every(([type]) => type === "work"),
    ).toBe(true);
  });

  it("promotes the next poster when the active one is deleted", async () => {
    const a = await collection("A");
    const first = await createMedia({
      collectionId: a.id,
      type: "poster",
      s3Key: "a1.webp",
      sortOrder: 0,
    });
    const second = await createMedia({
      collectionId: a.id,
      type: "poster",
      s3Key: "a2.webp",
      sortOrder: 1,
    });
    await setActiveMedia(first.id);
    await deleteMedia(first.id);
    const rows = await getMediaByType(a.id, "poster", "collection");
    expect(rows.map((r) => [r.id, r.isActive])).toEqual([[second.id, true]]);
  });

  it("enforces exactly one owner and no collection galleries", async () => {
    const a = await collection("A");
    const { work } = await book("Book");
    await expect(
      createMedia({ collectionId: a.id, type: "gallery", s3Key: "g.webp" }),
    ).rejects.toThrow();
    await expect(
      createMedia({
        collectionId: a.id,
        workId: work.id,
        type: "poster",
        s3Key: "x.webp",
      }),
    ).rejects.toThrow();
    // The database check holds even without the app validation.
    await expect(
      db
        .insert(schema.media)
        .values({
          collectionId: a.id,
          workId: work.id,
          type: "poster",
          s3Key: "x.webp",
        }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.media).values({ type: "poster", s3Key: "orphan.webp" }),
    ).rejects.toThrow();
    await expect(
      getMediaByType(a.id, "poster", "shelf" as never),
    ).rejects.toThrow();
  });

  it("returns only active artwork with collections", async () => {
    const a = await collection("A");
    const old = await createMedia({
      collectionId: a.id,
      type: "poster",
      s3Key: "old.webp",
    });
    const current = await createMedia({
      collectionId: a.id,
      type: "poster",
      s3Key: "new.webp",
    });
    await setActiveMedia(current.id);
    await createMedia({
      collectionId: a.id,
      type: "background",
      s3Key: "bg.webp",
    });
    const [listed] = await getCollections();
    expect(listed.media.map((m) => m.s3Key).sort()).toEqual([
      "bg.webp",
      "new.webp",
    ]);
    expect(
      (await getCollection(a.id))!.media.some((m) => m.id === old.id),
    ).toBe(false);
  });

  it("lists the collections that hold any edition of a book, once each", async () => {
    const target = await book("Target", 2);
    const other = await book("Other");
    const both = await collection("Both", 1);
    const one = await collection("One", 0);
    const unrelated = await collection("Unrelated", 0);
    await member(both.id, target.editions[0].id);
    await member(both.id, target.editions[1].id, 1);
    await member(both.id, other.editions[0].id, 2);
    await member(one.id, target.editions[1].id);
    await member(unrelated.id, other.editions[0].id);
    const poster = await createMedia({
      collectionId: both.id,
      type: "poster",
      s3Key: "both.webp",
    });
    await createMedia({
      collectionId: both.id,
      type: "poster",
      s3Key: "inactive.webp",
      isActive: false,
    });

    const found = await getCollectionsForWork(target.work.id);
    expect(found.map((c) => c.name)).toEqual(["One", "Both"]);
    const bothEntry = found[1];
    expect(bothEntry.editionCount).toBe(3);
    expect(bothEntry.heldEditions.map((e) => e.editionId).sort()).toEqual(
      target.editions.map((e) => e.id).sort(),
    );
    expect(bothEntry.media.map((m) => m.id)).toEqual([poster.id]);
    expect(found[0].heldEditions.map((e) => e.editionId)).toEqual([
      target.editions[1].id,
    ]);
    expect(await getCollectionsForWork(other.work.id)).toHaveLength(2);
    const [lonely] = await db
      .insert(schema.works)
      .values({ title: "Lonely" })
      .returning();
    expect(await getCollectionsForWork(lonely.id)).toEqual([]);
  });

  it("uploads a collection poster as an active media row and refuses a gallery", async () => {
    const a = await collection("A");
    const form = (mediaType: string) => {
      const data = new FormData();
      data.set(
        "file",
        new File([new Uint8Array([1, 2, 3])], "poster.png", {
          type: "image/png",
        }),
      );
      data.set("entityType", "collection");
      data.set("entityId", a.id);
      data.set("mediaType", mediaType);
      return new Request("http://localhost/api/media/upload", {
        method: "POST",
        body: data,
      });
    };
    const response = await upload(form("poster") as never);
    expect(response.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.media)
      .where(eq(schema.media.collectionId, a.id));
    expect(row).toMatchObject({
      type: "poster",
      isActive: true,
      workId: null,
      authorId: null,
    });
    expect(row.s3Key.startsWith(`gold/media/collection/${a.id}/poster/`)).toBe(
      true,
    );

    vi.mocked(renderImage).mockClear();
    const refused = await upload(form("gallery") as never);
    expect(refused.status).toBe(400);
    expect(renderImage).not.toHaveBeenCalled();
  });
});
