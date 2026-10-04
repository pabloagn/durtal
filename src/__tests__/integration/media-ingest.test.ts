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
import sharp from "sharp";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_MEDIA_INGEST_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln361_test")
    throw new Error("Media ingest tests require disposable local sln361_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;

// An in-memory bucket: uploads land here, cleanup lists and deletes here.
const bucket = vi.hoisted(() => ({
  objects: new Set<string>(),
  bodies: new Map<string, Buffer>(),
  failPut: new Set<string>(),
}));
vi.mock("@/lib/s3/covers", () => ({
  uploadToS3: vi.fn(async (key: string, body: Buffer) => {
    if ([...bucket.failPut].some((part) => key.includes(part))) throw new Error("Storage refused the upload");
    bucket.objects.add(key);
    bucket.bodies.set(key, body);
  }),
}));
vi.mock("@/lib/s3/client", () => ({
  S3_BUCKET: "local-test",
  s3: {
    send: vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        const prefix = command.input.Prefix ?? "";
        return { Contents: [...bucket.objects].filter((k) => k.startsWith(prefix)).map((Key) => ({ Key })), IsTruncated: false };
      }
      if (command instanceof DeleteObjectsCommand) {
        for (const { Key } of command.input.Delete?.Objects ?? []) bucket.objects.delete(Key!);
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const body = bucket.objects.has(command.input.Key!) ? bucket.bodies.get(command.input.Key!) : undefined;
        if (!body) throw new Error("NoSuchKey");
        return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
      }
      throw new Error("Unexpected S3 command");
    }),
  },
}));
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
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), cached: (fn: unknown) => fn, CACHE_TAGS: {} }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/color/extract-palette", () => ({ extractColorPalette: vi.fn(async () => null) }));
import { ingestMedia, MediaIngestError } from "@/lib/media/ingest";
import { updateMediaDetails } from "@/lib/actions/media";
import { createPerson } from "@/lib/actions/people";
import { saveOrganization, deleteOrganization } from "@/lib/actions/organizations";
import { createPerfume, createPerfumeVariant, deletePerfumeVariant } from "@/lib/actions/perfumes";
import { createArtObject, createPainting, deleteArtObject, deletePainting } from "@/lib/actions/paintings";
import { recordSourceObservation } from "@/lib/actions/catalogue-provenance";
import {
  importLegacyAuthorPhoto,
  isMonochromeImage,
  removeImportedAuthorPhoto,
  renderAuthorMediaMonochrome,
  replaceLegacyAuthorPhoto,
  restoreAuthorMediaColour,
  restoreLegacyAuthorPhoto,
  scanAuthorMedia,
  scanLegacyAuthorPhotos,
} from "@/lib/media/author-monochrome";

async function picture(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 90, g: 60, b: 30 } } }).jpeg().toBuffer();
}

const isMonochrome = (key: string) => isMonochromeImage(bucket.bodies.get(key)!);
async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error("Expected the call to fail");
    },
    (e: unknown) => e,
  );
  return error instanceof z.ZodError ? error.issues.map((i) => i.message).join("\n") : (error as Error).message;
}

describe.skipIf(!url)("one ingest path for every image owner", () => {
  const c = client!;
  let bookId: string, painting: { id: string }, objectId: string, variantId: string, perfumeId: string, orgId: string;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    bucket.objects.clear();
    bucket.bodies.clear();
    bucket.failPut.clear();
    await c`truncate works, authors, publishing_houses, media, catalogue_dates, image_adjustments, harmonization_operations, harmonization_redirects cascade`;
    [{ id: bookId }] = await c`insert into works(title) values ('A book') returning id`;
    painting = await createPainting({ title: "View of Delft" });
    objectId = (await createArtObject({ workId: painting.id, kind: "original" })).id;
    perfumeId = (await createPerfume({ title: "Shalimar" })).id;
    variantId = (await createPerfumeVariant({ workId: perfumeId, concentration: "extrait" })).id;
    orgId = (await saveOrganization({ name: "Mauritshuis", roles: ["museum"] }))!.id;
  });
  const keysUnder = (prefix: string) => [...bucket.objects].filter((k) => k.startsWith(prefix)).sort();

  it("stores each owner's images in its own folder at its domain's sizes", async () => {
    const book = await ingestMedia({ owner: { type: "work", id: bookId }, mediaType: "poster", buffer: await picture(3000, 4500), originalFilename: "cover.jpg" });
    expect(book).toMatchObject({ workId: bookId, width: 1600, height: 2400, originalS3Key: null, isActive: true, originalFilename: "cover.jpg" });
    const bottle = await ingestMedia({ owner: { type: "perfume_variant", id: variantId }, mediaType: "poster", buffer: await picture(3000, 2000) });
    expect(bottle).toMatchObject({ perfumeVariantId: variantId, workId: null, width: 2000, height: 1333 });
    const artwork = await ingestMedia({ owner: { type: "art_object", id: objectId }, mediaType: "poster", buffer: await picture(6000, 3000) });
    expect(artwork).toMatchObject({ artObjectId: objectId, width: 4096, height: 2048 });
    expect(keysUnder(`gold/media/art_object/${objectId}/`)).toEqual([artwork.s3Key, artwork.originalS3Key, artwork.thumbnailS3Key].sort());
    const logo = await ingestMedia({ owner: { type: "organization", id: orgId }, mediaType: "poster", buffer: await picture(2000, 2000) });
    expect(logo).toMatchObject({ organizationId: orgId, width: 1600, height: 1600 });
    const gallery = await ingestMedia({ owner: { type: "work", id: painting.id }, mediaType: "gallery", buffer: await picture(5000, 4000) });
    expect(gallery).toMatchObject({ width: 4096, height: 3277 });
    expect(gallery.originalS3Key).toMatch(new RegExp(`^gold/media/work/${painting.id}/gallery/.+_original\\.webp$`));
  }, 60000);

  it("activates a new poster in the same write that records it", async () => {
    const first = await ingestMedia({ owner: { type: "work", id: bookId }, mediaType: "poster", buffer: await picture(600, 900) });
    const second = await ingestMedia({ owner: { type: "work", id: bookId }, mediaType: "poster", buffer: await picture(600, 900) });
    const rows = await c`select id,is_active from media where work_id=${bookId} order by created_at`;
    expect(rows.map((r) => [r.id, r.is_active])).toEqual([[first.id, false], [second.id, true]]);
    await ingestMedia({ owner: { type: "work", id: bookId }, mediaType: "gallery", buffer: await picture(600, 600) });
    expect(await c`select 1 from media where work_id=${bookId} and type='poster' and is_active`).toHaveLength(1);
  });

  it("refuses an unsupported type or a missing owner before storing anything", async () => {
    const refused = ingestMedia({ owner: { type: "art_object", id: objectId }, mediaType: "background", buffer: await picture(100, 100) });
    await expect(refused).rejects.toBeInstanceOf(MediaIngestError);
    expect(await failure(refused)).toBe("This owner does not accept that image type");
    const missing = ingestMedia({ owner: { type: "organization", id: "00000000-0000-4000-8000-000000000000" }, mediaType: "poster", buffer: await picture(100, 100) });
    await expect(missing).rejects.toMatchObject({ status: 404 });
    expect(bucket.objects.size).toBe(0);
  });

  it("removes the stored files when the database refuses the row", async () => {
    const elsewhere = await recordSourceObservation({ owner: { kind: "perfume", id: perfumeId }, provider: "manual", retrievedAt: new Date(), payload: {} });
    expect(
      await failure(ingestMedia({ owner: { type: "art_object", id: objectId }, mediaType: "poster", buffer: await picture(800, 600), attribution: { sourceRecordId: elsewhere.id } })),
    ).toBe("The image source must belong to the same record as the image");
    expect(bucket.objects.size).toBe(0);
    expect(await c`select 1 from media`).toHaveLength(0);
  });

  it("removes the stored files when one upload fails", async () => {
    bucket.failPut.add("_thumb.webp");
    expect(await failure(ingestMedia({ owner: { type: "work", id: bookId }, mediaType: "poster", buffer: await picture(600, 900) }))).toBe("Storage refused the upload");
    expect(bucket.objects.size).toBe(0);
    expect(await c`select 1 from media`).toHaveLength(0);
  });

  it("keeps attribution with the image and edits it without touching the file", async () => {
    const source = await recordSourceObservation({ owner: { kind: "painting", id: painting.id }, provider: "museum", retrievedAt: new Date(), payload: {} });
    const row = await ingestMedia({
      owner: { type: "art_object", id: objectId },
      mediaType: "poster",
      buffer: await picture(800, 600),
      attribution: {
        altText: "A view of a Dutch town across a river",
        credit: "Mauritshuis, The Hague",
        license: "Public domain",
        licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
        sourceUrl: "https://www.mauritshuis.nl/en/our-collection/artworks/92-view-of-delft/",
        sourceRecordId: source.id,
      },
    });
    expect(row).toMatchObject({ altText: "A view of a Dutch town across a river", license: "Public domain", sourceRecordId: source.id });
    const files = [...bucket.objects].sort();
    const edited = await updateMediaDetails(row.id, { altText: "Delft seen from the Schie", credit: null });
    expect(edited).toMatchObject({ altText: "Delft seen from the Schie", credit: null, license: "Public domain", s3Key: row.s3Key });
    expect([...bucket.objects].sort()).toEqual(files);
    await expect(updateMediaDetails(row.id, { licenseUrl: "ftp://example.com/license" })).rejects.toBeInstanceOf(z.ZodError);
    const other = await recordSourceObservation({ owner: { kind: "perfume", id: perfumeId }, provider: "manual", retrievedAt: new Date(), payload: {} });
    expect(await failure(updateMediaDetails(row.id, { sourceRecordId: other.id }))).toBe("The image source must belong to the same record as the image");
  });

  it("keeps an author's colour original and default monochrome settings", async () => {
    const person = await createPerson({ name: "Joris-Karl Huysmans", domains: ["book"] });
    const portrait = await ingestMedia({ owner: { type: "author", id: person.id }, mediaType: "poster", buffer: await picture(1200, 1800) });
    expect(portrait.originalS3Key).toMatch(/_original\.webp$/);
    expect(portrait.processingParams).toBeTruthy();
    expect(bucket.objects.has(portrait.originalS3Key!)).toBe(true);
  });

  it("serves every author image in monochrome: portrait, background and gallery", async () => {
    const person = await createPerson({ name: "David Peace", domains: ["book"] });
    for (const mediaType of ["poster", "background", "gallery"] as const) {
      const row = await ingestMedia({ owner: { type: "author", id: person.id }, mediaType, buffer: await picture(1600, 900) });
      expect(await isMonochrome(row.s3Key), `${mediaType} full size`).toBe(true);
      expect(await isMonochrome(row.thumbnailS3Key!), `${mediaType} thumbnail`).toBe(true);
      // The colour copy is kept for re-tuning, never served
      expect(row.originalS3Key).toMatch(/_original\.webp$/);
      expect(await isMonochrome(row.originalS3Key!), `${mediaType} original`).toBe(false);
      expect(row.processingParams).toBeTruthy();
    }
    // A background keeps its landscape size
    const background = await ingestMedia({ owner: { type: "author", id: person.id }, mediaType: "background", buffer: await picture(4000, 2000) });
    expect(await sharp(bucket.bodies.get(background.s3Key)!).metadata()).toMatchObject({ width: 2560, height: 1280 });
  });

  it("re-renders an older colour author image in monochrome, keeps its crop, and undoes it", async () => {
    const person = await createPerson({ name: "Rachilde", domains: ["book"] });
    // An author background stored in colour before the rule, with no original
    const colour = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 140, g: 40, b: 30 } } }).webp().toBuffer();
    bucket.objects.add("legacy/background.webp");
    bucket.bodies.set("legacy/background.webp", colour);
    const [legacy] = await c`insert into media(author_id, type, s3_key, thumbnail_s3_key, width, height, is_active, crop_x, crop_y, crop_zoom)
      values (${person.id}, 'background', 'legacy/background.webp', 'legacy/background.webp', 1600, 900, true, 30, 60, 100) returning id`;
    let scan = await scanAuthorMedia();
    expect(scan.map((s) => [s.row.id, s.colour])).toEqual([[legacy.id, true]]);

    const change = await renderAuthorMediaMonochrome(scan[0].row);
    expect(change).toMatchObject({ id: legacy.id, before: { s3Key: "legacy/background.webp", originalS3Key: null, processingParams: null } });
    const [mono] = await c`select * from media where id = ${legacy.id}`;
    expect(mono).toMatchObject({ crop_x: 30, crop_y: 60, original_s3_key: change!.after.originalS3Key });
    expect(await isMonochrome(mono.s3_key)).toBe(true);
    expect(await isMonochrome(mono.thumbnail_s3_key)).toBe(true);
    // The colour copy is kept as the original, outside what views show
    expect(await isMonochrome(mono.original_s3_key)).toBe(false);
    scan = await scanAuthorMedia();
    expect(scan.filter((s) => s.colour)).toEqual([]);

    // Undo: colour display files again, and the row's original as before
    const restored = await restoreAuthorMediaColour(scan[0].row, change!);
    expect(restored).toMatchObject({ originalS3Key: null, processingParams: null, cropX: 30, cropY: 60 });
    expect(await isMonochrome(restored!.s3Key)).toBe(false);
    expect(bucket.objects.has(change!.after.originalS3Key)).toBe(false);
  });

  it("turns a legacy colour portrait into a monochrome poster image and photo, and back", async () => {
    const person = await createPerson({ name: "Jean Lorrain", domains: ["book"] });
    bucket.objects.add("legacy/portrait.jpg");
    bucket.bodies.set("legacy/portrait.jpg", await picture(600, 900));
    await c`update authors set photo_s3_key = 'legacy/portrait.jpg' where id = ${person.id}`;
    expect(await scanLegacyAuthorPhotos()).toEqual([
      { authorId: person.id, photoS3Key: "legacy/portrait.jpg", colour: true, hasPoster: false },
    ]);
    const id = await importLegacyAuthorPhoto(person.id, "legacy/portrait.jpg");
    const [poster] = await c`select * from media where id = ${id}`;
    expect(poster).toMatchObject({ author_id: person.id, type: "poster", is_active: true });
    expect(await isMonochrome(poster.s3_key)).toBe(true);

    // The photo column points at a monochrome copy; the colour file stays for undo
    const copy = await replaceLegacyAuthorPhoto(person.id, "legacy/portrait.jpg");
    expect(copy).toMatch(new RegExp(`^gold/media/author/${person.id}/photo/.+\\.webp$`));
    expect(await isMonochrome(copy!)).toBe(true);
    expect(bucket.objects.has("legacy/portrait.jpg")).toBe(true);
    expect(await scanLegacyAuthorPhotos()).toEqual([
      { authorId: person.id, photoS3Key: copy, colour: false, hasPoster: true },
    ]);

    // Should the poster image go later, views fall back to the photo column: monochrome now
    const [{ photo_s3_key: fallback }] = await c`select photo_s3_key from authors where id = ${person.id}`;
    expect(fallback).toBe(copy);

    // Undo: the colour key first, then the poster image and the copy go
    expect(await restoreLegacyAuthorPhoto(person.id, "legacy/portrait.jpg", copy!)).toBe(true);
    await removeImportedAuthorPhoto(id);
    expect(await c`select photo_s3_key from authors where id = ${person.id}`).toEqual([{ photo_s3_key: "legacy/portrait.jpg" }]);
    expect(await c`select id from media where id = ${id}`).toHaveLength(0);
    expect(bucket.objects.has(poster.s3_key)).toBe(false);
    expect(bucket.objects.has(copy!)).toBe(false);
    expect(bucket.objects.has("legacy/portrait.jpg")).toBe(true);
  });

  it("replaces a colour photo behind a poster image too, and leaves a changed one alone", async () => {
    const person = await createPerson({ name: "Marcel Schwob", domains: ["book"] });
    await ingestMedia({ owner: { type: "author", id: person.id }, mediaType: "poster", buffer: await picture(600, 900) });
    bucket.objects.add("legacy/schwob.jpg");
    bucket.bodies.set("legacy/schwob.jpg", await picture(600, 900));
    await c`update authors set photo_s3_key = 'legacy/schwob.jpg' where id = ${person.id}`;
    expect(await scanLegacyAuthorPhotos()).toEqual([
      { authorId: person.id, photoS3Key: "legacy/schwob.jpg", colour: true, hasPoster: true },
    ]);
    const copy = await replaceLegacyAuthorPhoto(person.id, "legacy/schwob.jpg");
    expect(await isMonochrome(copy!)).toBe(true);
    expect((await scanLegacyAuthorPhotos()).filter((l) => l.colour)).toEqual([]);

    // The column moved on since the scan: no change, and no file left behind
    const before = new Set(bucket.objects);
    expect(await replaceLegacyAuthorPhoto(person.id, "legacy/schwob.jpg")).toBeNull();
    expect(bucket.objects).toEqual(before);
    expect(await restoreLegacyAuthorPhoto(person.id, "legacy/schwob.jpg", "gold/media/author/x/photo/y.webp")).toBe(false);
  });

  it("re-tunes only a person's image from its original", async () => {
    const row = await ingestMedia({ owner: { type: "art_object", id: objectId }, mediaType: "poster", buffer: await picture(800, 600) });
    expect(row.originalS3Key).toBeTruthy();
    await expect(renderAuthorMediaMonochrome(row)).rejects.toThrow("Only a person's images");
  });

  it("keeps the colours of every image that is not a person's", async () => {
    const row = await ingestMedia({ owner: { type: "organization", id: orgId }, mediaType: "poster", buffer: await picture(500, 500) });
    expect(await isMonochrome(row.s3Key)).toBe(false);
    const cover = await ingestMedia({ owner: { type: "work", id: bookId }, mediaType: "background", buffer: await picture(1600, 900) });
    expect(await isMonochrome(cover.s3Key)).toBe(false);
  });

  it("removes the files of a deleted object, formulation, organization or painting", async () => {
    await ingestMedia({ owner: { type: "art_object", id: objectId }, mediaType: "poster", buffer: await picture(800, 600) });
    const bottle = await ingestMedia({ owner: { type: "perfume_variant", id: variantId }, mediaType: "poster", buffer: await picture(800, 800) });
    await ingestMedia({ owner: { type: "organization", id: orgId }, mediaType: "poster", buffer: await picture(500, 500) });
    expect(await deleteArtObject(objectId)).toMatchObject({ cleanupPending: false });
    expect(keysUnder(`gold/media/art_object/${objectId}/`)).toEqual([]);
    expect(bucket.objects.has(bottle.s3Key)).toBe(true);
    await deletePerfumeVariant(variantId);
    expect(keysUnder(`gold/media/perfume_variant/${variantId}/`)).toEqual([]);
    await deleteOrganization(orgId);
    expect(keysUnder(`gold/media/organization/${orgId}/`)).toEqual([]);
    // A whole painting takes its objects' images with it.
    const second = (await createArtObject({ workId: painting.id, kind: "version", label: "Copy" })).id;
    const secondImage = await ingestMedia({ owner: { type: "art_object", id: second }, mediaType: "poster", buffer: await picture(600, 400) });
    const workImage = await ingestMedia({ owner: { type: "work", id: painting.id }, mediaType: "poster", buffer: await picture(600, 400) });
    await deletePainting(painting.id);
    for (const key of [secondImage.s3Key, secondImage.thumbnailS3Key!, workImage.s3Key]) expect(bucket.objects.has(key), key).toBe(false);
    expect(bucket.objects.size).toBe(0);
  }, 60000);

  it("allows exactly one owner and only that owner's image types", async () => {
    await expect(c`insert into media(work_id,organization_id,type,s3_key) values (${bookId},${orgId},'poster','k')`).rejects.toThrow("media_owner_check");
    await expect(c`insert into media(art_object_id,type,s3_key) values (${objectId},'background','k')`).rejects.toThrow("media_type_check");
    await expect(c`insert into media(work_id,type,s3_key,source_url) values (${bookId},'poster','k','javascript:alert(1)')`).rejects.toThrow("media_attribution_check");
  });
});
