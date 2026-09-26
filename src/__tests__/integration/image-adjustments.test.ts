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
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  s3ImageSource,
} from "@/lib/utils/image-adjustments";
const url = process.env.DURTAL_IMAGE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln316_test"
  )
    throw new Error("Image tests require disposable local sln316_test");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, p) => {
        if (!testDb) throw new Error("Local test DB required");
        return Reflect.get(testDb, p);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: { media: "media" },
}));
import {
  getImagePresentation,
  saveImagePresentation,
  getImageAdjustmentStyles,
} from "@/lib/actions/image-adjustments";

describe.skipIf(!url)("shared image adjustments with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate image_adjustments, works, authors, collections, venues, comments, calibre_books cascade`,
    );
  });
  async function poster(author = false, type: "poster" | "gallery" = "poster") {
    const [entity] = author
      ? await db.insert(schema.authors).values({ name: "Portrait" }).returning()
      : await db.insert(schema.works).values({ title: "Cover" }).returning();
    return (
      await db
        .insert(schema.media)
        .values({
          ...(author ? { authorId: entity.id } : { workId: entity.id }),
          type,
          s3Key: "gold/full.jpg",
          thumbnailS3Key: "gold/thumb.jpg",
          originalS3Key: "bronze/original.jpg",
          brightness: 115,
          contrast: 125,
          cropX: 25,
          cropY: 70,
          cropZoom: 135,
        })
        .returning()
    )[0];
  }
  it("reads existing brightness, contrast and crop without writing or touching originals", async () => {
    const item = await poster();
    const result = await getImagePresentation(
      s3ImageSource(item.thumbnailS3Key!),
    );
    expect(result).toMatchObject({
      assetKey: item.s3Key,
      settings: { brightness: 115, contrast: 125, exposure: 0 },
      crop: { cropX: 25, cropY: 70, cropZoom: 135 },
    });
    expect(await getImageAdjustmentStyles()).toEqual([]);
    expect((await db.select().from(schema.media))[0]).toEqual(item);
  });
  it("saves once for full image and thumbnail, preserves omitted crop and supports reset", async () => {
    const item = await poster();
    const saved = await saveImagePresentation(
      s3ImageSource(item.thumbnailS3Key!),
      { settings: { exposure: 0.5, saturation: 125, brightness: 120 } },
    );
    expect(saved.sources).toEqual([
      s3ImageSource(item.s3Key),
      s3ImageSource(item.thumbnailS3Key!),
    ]);
    expect(
      (await getImagePresentation(s3ImageSource(item.s3Key))).settings,
    ).toMatchObject({ exposure: 0.5, brightness: 120, saturation: 125 });
    expect((await db.select().from(schema.media))[0]).toMatchObject({
      cropX: 25,
      cropY: 70,
      cropZoom: 135,
      brightness: 120,
      s3Key: item.s3Key,
      originalS3Key: item.originalS3Key,
    });
    await saveImagePresentation(s3ImageSource(item.s3Key), {
      settings: DEFAULT_IMAGE_ADJUSTMENTS,
      crop: { cropX: 50, cropY: 50, cropZoom: 100 },
    });
    expect(await getImageAdjustmentStyles()).toHaveLength(1);
    expect(
      (await getImagePresentation(s3ImageSource(item.s3Key))).settings,
    ).toEqual(DEFAULT_IMAGE_ADJUSTMENTS);
  });
  it("enforces author monochrome server-side and refuses original color assets", async () => {
    const item = await poster(true);
    const saved = await saveImagePresentation(s3ImageSource(item.s3Key), {
      settings: { saturation: 200, grayscale: 0, sepia: 100 },
    });
    expect(saved).toMatchObject({
      monochrome: true,
      settings: { saturation: 100, grayscale: 100, sepia: 0 },
    });
    await expect(
      saveImagePresentation(s3ImageSource(item.originalS3Key!), {
        settings: {},
      }),
    ).rejects.toThrow("Image not found");
  });
  it("supports galleries while rejecting crop settings their renderers cannot display", async () => {
    const item = await poster(false, "gallery");
    expect(
      (await getImagePresentation(s3ImageSource(item.s3Key))).crop,
    ).toBeNull();
    await saveImagePresentation(s3ImageSource(item.s3Key), {
      settings: { sepia: 30 },
    });
    await expect(
      saveImagePresentation(s3ImageSource(item.s3Key), {
        settings: {},
        crop: { cropX: 50, cropY: 50, cropZoom: 100 },
      }),
    ).rejects.toThrow("does not support");
  });
  it("resolves edition and venue thumbnails to their full assets", async () => {
    const [work] = await db
      .insert(schema.works)
      .values({ title: "Edition" })
      .returning();
    await db
      .insert(schema.editions)
      .values({
        workId: work.id,
        title: "Edition",
        coverS3Key: "edition.jpg",
        thumbnailS3Key: "edition-thumb.jpg",
      });
    await db
      .insert(schema.venues)
      .values({
        name: "Venue",
        type: "bookshop",
        posterS3Key: "venue.jpg",
        thumbnailS3Key: "venue-thumb.jpg",
      });
    for (const name of ["edition", "venue"]) {
      const saved = await saveImagePresentation(
        s3ImageSource(`${name}-thumb.jpg`),
        { settings: { contrast: 110 } },
      );
      expect(saved.assetKey).toBe(`${name}.jpg`);
      expect(saved.sources).toHaveLength(2);
    }
  });
  it("keeps collection poster, background and separate legacy cover independent", async () => {
    await db
      .insert(schema.collections)
      .values({
        name: "Collection",
        posterS3Key: "poster.jpg",
        posterThumbnailS3Key: "thumb.jpg",
        backgroundS3Key: "background.jpg",
        coverS3Key: "legacy.jpg",
      });
    expect(
      (
        await saveImagePresentation(s3ImageSource("thumb.jpg"), {
          settings: { exposure: 1 },
        })
      ).sources,
    ).toEqual([s3ImageSource("poster.jpg"), s3ImageSource("thumb.jpg")]);
    for (const key of ["background.jpg", "legacy.jpg"])
      expect(
        (await getImagePresentation(s3ImageSource(key))).settings.exposure,
      ).toBe(0);
  });
  it("supports legacy author photos and reader cover aliases", async () => {
    await db
      .insert(schema.authors)
      .values({ name: "Legacy", photoS3Key: "portrait.jpg" });
    expect(
      (
        await saveImagePresentation(s3ImageSource("portrait.jpg"), {
          settings: {},
        })
      ).monochrome,
    ).toBe(true);
    await db
      .insert(schema.calibreBooks)
      .values({
        calibreId: 42,
        title: "Digital",
        path: "local-fixture",
        coverS3Key: "reader.jpg",
      });
    const saved = await saveImagePresentation("/api/reader/42/cover", {
      settings: { exposure: 1 },
    });
    expect(saved.sources).toContain(s3ImageSource("reader.jpg"));
    expect(
      (await getImagePresentation(s3ImageSource("reader.jpg"))).settings
        .exposure,
    ).toBe(1);
  });
  it("supports image attachments but never treats documents as editable pictures", async () => {
    const [work] = await db
      .insert(schema.works)
      .values({ title: "Comments" })
      .returning();
    const [comment] = await db
      .insert(schema.comments)
      .values({ entityType: "work", entityId: work.id, contentHtml: "Fixture" })
      .returning();
    await db.insert(schema.commentAttachments).values([
      {
        commentId: comment.id,
        fileName: "photo.jpg",
        fileSize: 100,
        mimeType: "image/jpeg",
        s3Key: "photo.jpg",
        isImage: true,
      },
      {
        commentId: comment.id,
        fileName: "document.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        s3Key: "document.pdf",
        isImage: false,
      },
    ]);
    expect(
      (
        await saveImagePresentation(s3ImageSource("photo.jpg"), {
          settings: { exposure: 1 },
        })
      ).assetKey,
    ).toBe("photo.jpg");
    await expect(
      saveImagePresentation(s3ImageSource("document.pdf"), { settings: {} }),
    ).rejects.toThrow("Image not found");
  });
  it("rejects unknown assets and invalid input without persisting anything", async () => {
    const item = await poster();
    await expect(
      saveImagePresentation(s3ImageSource("missing.jpg"), { settings: {} }),
    ).rejects.toThrow("Image not found");
    await expect(
      saveImagePresentation(s3ImageSource(item.s3Key), {
        settings: { exposure: 9 },
      }),
    ).rejects.toThrow();
    expect(await getImageAdjustmentStyles()).toEqual([]);
  });
  it("rolls the settings upsert back if the paired legacy update fails", async () => {
    const item = await poster();
    await db.execute(
      sql`alter table media add constraint image_test_failure check (brightness <> 199)`,
    );
    try {
      await expect(
        saveImagePresentation(s3ImageSource(item.s3Key), {
          settings: { exposure: 1, brightness: 199 },
        }),
      ).rejects.toThrow();
      expect(await getImageAdjustmentStyles()).toEqual([]);
      expect(
        (
          await db
            .select()
            .from(schema.media)
            .where(eq(schema.media.id, item.id))
        )[0],
      ).toEqual(item);
    } finally {
      await db.execute(
        sql`alter table media drop constraint image_test_failure`,
      );
    }
  });
});
