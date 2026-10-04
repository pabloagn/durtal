import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  onTestFinished,
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
// In-memory S3: crops write real files through sharp
const store = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@/lib/s3/client", async () => {
  const { PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } =
    await import("@aws-sdk/client-s3");
  return {
    S3_BUCKET: "local-test",
    s3: {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof PutObjectCommand) {
          store.set(command.input.Key!, Buffer.from(command.input.Body as Buffer));
          return {};
        }
        if (command instanceof GetObjectCommand) {
          const body = store.get(command.input.Key!);
          if (!body) throw new Error(`NoSuchKey ${command.input.Key}`);
          return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
        }
        if (command instanceof DeleteObjectsCommand) {
          for (const o of command.input.Delete!.Objects!) store.delete(o.Key!);
          return { Errors: [] };
        }
        throw new Error("Unexpected S3 command");
      }),
    },
  };
});
import {
  getImagePresentation,
  saveImagePresentation,
  getImageAdjustmentStyles,
} from "@/lib/actions/image-adjustments";
import { buildDisplayFiles, commitDisplay } from "@/lib/media/display";
import { POST as applyCrops } from "@/app/api/media/apply-crops/route";
import { POST as reprocessAuthor } from "@/app/api/media/reprocess-author/route";
import { NextRequest } from "next/server";
import sharp from "sharp";

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
  it("keeps collection poster and background independent, with framing like book media", async () => {
    const [collection] = await db
      .insert(schema.collections)
      .values({ name: "Collection" })
      .returning();
    await db.insert(schema.media).values([
      {
        collectionId: collection.id,
        type: "poster",
        s3Key: "poster.jpg",
        thumbnailS3Key: "thumb.jpg",
      },
      {
        collectionId: collection.id,
        type: "background",
        s3Key: "background.jpg",
      },
    ]);
    store.set("poster.jpg", await quadrants());
    const saved = await saveImagePresentation(s3ImageSource("thumb.jpg"), {
      settings: { exposure: 1 },
      crop: { cropX: 30, cropY: 40, cropZoom: 120 },
    });
    const [row] = await db
      .select()
      .from(schema.media)
      .where(eq(schema.media.type, "poster"));
    expect(row.s3Key).toMatch(
      new RegExp(`^gold/media/collection/${collection.id}/poster/${row.id}_`),
    );
    expect(row.uncroppedS3Key).toBe("poster.jpg");
    expect(saved.sources).toEqual([
      s3ImageSource(row.s3Key),
      s3ImageSource(row.thumbnailS3Key!),
    ]);
    const poster = await getImagePresentation(s3ImageSource(row.s3Key));
    expect(poster.crop).toEqual({ cropX: 30, cropY: 40, cropZoom: 120 });
    expect(poster.aspect).toBe(2 / 3);
    expect(poster.settings.exposure).toBe(1);
    const background = await getImagePresentation(
      s3ImageSource("background.jpg"),
    );
    expect(background.settings.exposure).toBe(0);
    expect(background.aspect).toBe(16 / 9);
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

  // ── Real crop: the crop is in the files, the uncropped image is kept ──────

  async function croppablePoster(author = false) {
    store.clear();
    const [owner] = author
      ? await db.insert(schema.authors).values({ name: "Portrait" }).returning()
      : await db.insert(schema.works).values({ title: "Cover" }).returning();
    const kind = author ? "author" : "work";
    const s3Key = `gold/media/${kind}/${owner.id}/poster/upload.webp`;
    const thumbnailS3Key = `gold/media/${kind}/${owner.id}/poster/upload_thumb.webp`;
    const originalS3Key = author
      ? `gold/media/${kind}/${owner.id}/poster/upload_original.webp`
      : undefined;
    const image = await quadrants();
    store.set(s3Key, image);
    store.set(thumbnailS3Key, image);
    if (originalS3Key) store.set(originalS3Key, image);
    const [item] = await db
      .insert(schema.media)
      .values({
        ...(author ? { authorId: owner.id } : { workId: owner.id }),
        type: "poster",
        s3Key,
        thumbnailS3Key,
        originalS3Key,
        width: 300,
        height: 450,
      })
      .returning();
    return { item, image };
  }
  const row = async (id: string) =>
    (await db.select().from(schema.media).where(eq(schema.media.id, id)))[0];
  const cropTo = (source: string, cropX: number, cropY: number, cropZoom: number) =>
    saveImagePresentation(source, {
      settings: { contrast: 110 },
      crop: { cropX, cropY, cropZoom },
    });

  it("writes the crop into new files and keeps the uncropped image untouched", async () => {
    const { item, image } = await croppablePoster();
    // Zoom 200 at the top-left corner: the top-left quadrant, red
    const saved = await cropTo(s3ImageSource(item.s3Key), 0, 0, 200);
    const after = await row(item.id);
    expect(after).toMatchObject({
      uncroppedS3Key: item.s3Key,
      appliedCrop: { x: 0, y: 0, zoom: 200 },
      // Only the focal point stays as CSS framing, without zoom
      cropX: 0,
      cropY: 0,
      cropZoom: 100,
      width: 150,
      height: 225,
      contrast: 110,
    });
    expect(after.s3Key).not.toBe(item.s3Key);
    expect(after.thumbnailS3Key).not.toBe(item.thumbnailS3Key);
    expect(await colorOf(store.get(after.s3Key)!)).toBe("red");
    expect(await colorOf(store.get(after.thumbnailS3Key!)!)).toBe("red");
    // The uncropped image is byte-identical; the old thumbnail is gone
    expect(store.get(item.s3Key)).toEqual(image);
    expect(store.has(item.thumbnailS3Key!)).toBe(false);
    // Settings follow the new image
    expect(saved).toMatchObject({
      assetKey: after.s3Key,
      sources: [s3ImageSource(after.s3Key), s3ImageSource(after.thumbnailS3Key!)],
    });
    // The editor crops the uncropped image, from the saved crop
    const presentation = await getImagePresentation(s3ImageSource(after.thumbnailS3Key!));
    expect(presentation).toMatchObject({
      assetKey: after.s3Key,
      preview: s3ImageSource(item.s3Key),
      crop: { cropX: 0, cropY: 0, cropZoom: 200 },
      settings: { contrast: 110 },
    });
  });

  it("re-crops from the uncropped image and a reset restores it", async () => {
    const { item, image } = await croppablePoster();
    await cropTo(s3ImageSource(item.s3Key), 0, 0, 200);
    const first = await row(item.id);
    // An editor opened before the first crop still saves
    await cropTo(s3ImageSource(item.s3Key), 100, 100, 200);
    const second = await row(item.id);
    expect(await colorOf(store.get(second.s3Key)!)).toBe("blue");
    expect(second.uncroppedS3Key).toBe(item.s3Key);
    expect(store.has(first.s3Key)).toBe(false);
    expect(store.has(first.thumbnailS3Key!)).toBe(false);

    // Same crop again: no new files
    await cropTo(s3ImageSource(second.s3Key), 100, 100, 200);
    expect((await row(item.id)).s3Key).toBe(second.s3Key);

    await cropTo(s3ImageSource(second.s3Key), 50, 50, 100);
    const reset = await row(item.id);
    expect(reset).toMatchObject({
      s3Key: item.s3Key,
      uncroppedS3Key: null,
      appliedCrop: null,
      width: 300,
      height: 450,
    });
    expect(store.get(item.s3Key)).toEqual(image);
    expect(store.has(second.s3Key)).toBe(false);
    expect([...store.keys()].sort()).toEqual([item.s3Key, reset.thumbnailS3Key].sort());
    expect(
      (await db.select().from(schema.imageAdjustments)).map((r) => r.assetKey),
    ).toEqual([item.s3Key]);
  });

  it("writes no file for a crop that cuts nothing, and keeps its focal point", async () => {
    const { item } = await croppablePoster();
    // 2:3 image in the 2:3 frame without zoom: the whole image
    await cropTo(s3ImageSource(item.s3Key), 30, 80, 100);
    expect(await row(item.id)).toMatchObject({
      s3Key: item.s3Key,
      thumbnailS3Key: item.thumbnailS3Key,
      uncroppedS3Key: null,
      appliedCrop: null,
      cropX: 30,
      cropY: 80,
      cropZoom: 100,
    });
    expect(store.size).toBe(2);
    expect(
      (await getImagePresentation(s3ImageSource(item.s3Key))).crop,
    ).toEqual({ cropX: 30, cropY: 80, cropZoom: 100 });
  });

  it("cuts an image of another shape to the frame without zoom", async () => {
    const { item } = await croppablePoster();
    store.set(item.s3Key, await quadrants(600, 450));
    // The 2:3 frame on a 4:3 image: the left 300px at x = 0
    await cropTo(s3ImageSource(item.s3Key), 0, 50, 100);
    const after = await row(item.id);
    expect(after).toMatchObject({
      uncroppedS3Key: item.s3Key,
      appliedCrop: { x: 0, y: 50, zoom: 100 },
      width: 300,
      height: 450,
    });
    const top = await sharp(store.get(after.s3Key)!).extract({ left: 0, top: 0, width: 300, height: 225 }).toBuffer();
    expect(await colorOf(top)).toBe("red");
  });

  it("never deletes a file another record still uses", async () => {
    const { item } = await croppablePoster();
    // A poster reusing an edition cover, as harmonization creates
    const [work] = await db.insert(schema.works).values({ title: "Shared" }).returning();
    await db.insert(schema.editions).values({
      workId: work.id,
      title: "Shared",
      coverS3Key: item.s3Key,
      thumbnailS3Key: item.thumbnailS3Key,
    });
    await cropTo(s3ImageSource(item.s3Key), 0, 0, 200);
    expect(store.has(item.s3Key)).toBe(true);
    expect(store.has(item.thumbnailS3Key!)).toBe(true);
  });

  it("discards the new files and writes nothing when the row changed meanwhile", async () => {
    const { item } = await croppablePoster();
    const files = await buildDisplayFiles(item, { x: 0, y: 0, zoom: 200 });
    expect(files!.created.every((key) => store.has(key))).toBe(true);
    await db
      .update(schema.media)
      .set({ s3Key: "gold/elsewhere.webp" })
      .where(eq(schema.media.id, item.id));
    expect(await commitDisplay(item, files, {})).toBeNull();
    expect(files!.created.some((key) => store.has(key))).toBe(false);
    expect(await row(item.id)).toMatchObject({ s3Key: "gold/elsewhere.webp", uncroppedS3Key: null });
  });

  it("moves crops saved as CSS framing into files, once", async () => {
    vi.stubEnv("ADMIN_TOKEN", "test-admin-token");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const { item } = await croppablePoster();
    await db
      .update(schema.media)
      .set({ cropX: 100, cropY: 100, cropZoom: 200 })
      .where(eq(schema.media.id, item.id));
    const call = async (query = "") =>
      (await applyCrops(new NextRequest(`http://local/api/media/apply-crops${query}`, {
        method: "POST",
        headers: { "x-admin-token": "test-admin-token" },
      }))).json();
    expect(await call("?dryRun=1")).toMatchObject({ dryRun: true, total: 1 });
    expect((await row(item.id)).uncroppedS3Key).toBeNull();
    expect(await call()).toEqual({ total: 1, applied: 1, unchanged: 0, failed: [] });
    const after = await row(item.id);
    expect(after).toMatchObject({
      uncroppedS3Key: item.s3Key,
      appliedCrop: { x: 100, y: 100, zoom: 200 },
      cropX: 100,
      cropY: 100,
      cropZoom: 100,
    });
    expect(await colorOf(store.get(after.s3Key)!)).toBe("blue");
    expect(await call()).toEqual({ total: 0, applied: 0, unchanged: 0, failed: [] });
  });

  it("keeps the crop when author monochrome is tuned again, and the color original", async () => {
    const { item, image } = await croppablePoster(true);
    await cropTo(s3ImageSource(item.s3Key), 0, 0, 200);
    const cropped = await row(item.id);
    const response = await reprocessAuthor(
      new NextRequest("http://local/api/media/reprocess-author", {
        method: "POST",
        body: JSON.stringify({ mediaId: item.id, processingParams: { contrast: 1.5 } }),
      }),
    );
    expect(response.status).toBe(200);
    const tuned = await row(item.id);
    expect(tuned).toMatchObject({
      appliedCrop: { x: 0, y: 0, zoom: 200 },
      processingParams: { contrast: 1.5 },
      width: 150,
      height: 225,
    });
    expect(tuned.uncroppedS3Key).not.toBe(cropped.uncroppedS3Key);
    expect(store.get(item.originalS3Key!)).toEqual(image);
    // The old monochrome image and old crop are replaced
    expect(store.has(item.s3Key)).toBe(false);
    expect(store.has(cropped.s3Key)).toBe(false);
    expect(await colorOf(store.get(tuned.s3Key)!)).toBe("gray");
    // Settings follow the image
    expect(
      (await getImagePresentation(s3ImageSource(tuned.s3Key))).settings.contrast,
    ).toBe(110);
  });
});

/** Red, green / white, blue quadrants. */
async function quadrants(w = 300, h = 450): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [left, top] = [x < w / 2, y < h / 2];
      const rgb = top ? (left ? [255, 0, 0] : [0, 255, 0]) : left ? [255, 255, 255] : [0, 0, 255];
      raw.set(rgb, (y * w + x) * 3);
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).webp({ lossless: true }).toBuffer();
}

async function colorOf(image: Buffer): Promise<string> {
  const { channels } = await sharp(image).stats();
  const [r, g, b] = channels.map((c) => c.mean);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 10) return r > 200 ? "white" : "gray";
  if (r > 200 && g < 40 && b < 40) return "red";
  if (b > 200 && r < 40 && g < 40) return "blue";
  if (g > 200 && r < 40 && b < 40) return "green";
  return `mixed(${[r, g, b].map(Math.round).join(",")})`;
}
