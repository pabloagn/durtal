/**
 * Every image of a person is shown in monochrome (SLN-422). New images are
 * made monochrome when they arrive (`imagePolicy`, `ingestMedia`); these
 * helpers bring older author images in colour to the same state, and back.
 *
 * - A colour image is re-rendered in monochrome from its colour original,
 *   with the row's tuning (or the defaults), and keeps its crop.
 * - An image stored before it had an original first gets one: its uncropped
 *   colour file is copied to an original key, so it can be tuned again and
 *   the change can be undone.
 * - Undo rebuilds colour display files from that original and puts the
 *   row's original and tuning back as they were.
 * - A legacy portrait (`authors.photo_s3_key`, shown when the author has no
 *   poster image) becomes a monochrome poster image; undo removes it again.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, notExists } from "drizzle-orm";
import { db } from "@/lib/db";
import { authors, media } from "@/lib/db/schema";
import { uploadToS3 } from "@/lib/s3/covers";
import { goldMediaOriginalKey } from "@/lib/s3/keys";
import { deleteUnusedObjects } from "@/lib/s3/cleanup";
import { applyMonochromeProcessing } from "@/lib/s3/media";
import {
  DEFAULT_MONOCHROME_PARAMS,
  parseProcessingParams,
  type MonochromeParams,
} from "@/lib/validations/media";
import {
  buildDisplayFiles,
  commitDisplay,
  displayFraming,
  editorCrop,
  readS3Object,
} from "./display";
import { ingestMedia } from "./ingest";

type MediaRow = typeof media.$inferSelect;

/** What a re-render changed on one row: enough to undo it. */
export interface AuthorMonochromeChange {
  id: string;
  type: string;
  authorId: string;
  before: {
    s3Key: string;
    originalS3Key: string | null;
    processingParams: MonochromeParams | null;
  };
  after: { s3Key: string; originalS3Key: string };
}

/** Whether an image has no colour: its colour channels have the same mean. */
export async function isMonochromeImage(buffer: Buffer): Promise<boolean> {
  const sharp = (await import("sharp")).default;
  const [r, g, b] = (await sharp(buffer).stats()).channels;
  if (!g || !b) return true;
  // Rounding in the WebP encoder leaves a trace of chroma in grey images
  return Math.abs(r.mean - g.mean) < 0.5 && Math.abs(g.mean - b.mean) < 0.5;
}

/** Every author image row, with whether the file it shows is in colour. */
export async function scanAuthorMedia(): Promise<
  { row: MediaRow; colour: boolean }[]
> {
  const rows = await db.select().from(media).where(isNotNull(media.authorId));
  const scanned = [];
  for (const row of rows) {
    // The thumbnail is what most views show; the full size shows on the page
    const keys = [row.thumbnailS3Key, row.s3Key].filter((k): k is string => !!k);
    let colour = false;
    for (const key of keys)
      if (!(await isMonochromeImage(await readS3Object(key)))) colour = true;
    scanned.push({ row, colour });
  }
  return scanned;
}

/** Show one author image in monochrome. Returns null when the row changed meanwhile. */
export async function renderAuthorMediaMonochrome(
  row: MediaRow,
): Promise<AuthorMonochromeChange | null> {
  if (!row.authorId) throw new Error("Only a person's images are made monochrome");
  let originalS3Key = row.originalS3Key;
  let copied: string | null = null;
  const colour = await readS3Object(originalS3Key ?? row.uncroppedS3Key ?? row.s3Key);
  if (!originalS3Key) {
    originalS3Key = goldMediaOriginalKey("author", row.authorId, row.type, randomUUID());
    await uploadToS3(originalS3Key, colour, "image/webp");
    copied = originalS3Key;
  }
  const params = parseProcessingParams(row.processingParams) ?? DEFAULT_MONOCHROME_PARAMS;
  const crop = editorCrop(row);
  const files = await buildDisplayFiles(row, crop, await applyMonochromeProcessing(colour, params));
  const updated = await commitDisplay(row, files, {
    processingParams: params,
    originalS3Key,
    ...displayFraming(crop),
  });
  if (!updated) {
    if (copied) await deleteUnusedObjects({ keys: [copied], prefixes: [] }, "unused author original");
    return null;
  }
  return {
    id: row.id,
    type: row.type,
    authorId: row.authorId,
    before: {
      s3Key: row.s3Key,
      originalS3Key: row.originalS3Key,
      processingParams: parseProcessingParams(row.processingParams),
    },
    after: { s3Key: updated.s3Key, originalS3Key },
  };
}

/** Undo one re-render: colour display files again, from the kept original. */
export async function restoreAuthorMediaColour(
  row: MediaRow,
  change: AuthorMonochromeChange,
): Promise<MediaRow | null> {
  if (!row.originalS3Key) throw new Error("This image has no colour original to restore from");
  const crop = editorCrop(row);
  const files = await buildDisplayFiles(row, crop, await readS3Object(row.originalS3Key));
  const updated = await commitDisplay(row, files, {
    processingParams: change.before.processingParams,
    originalS3Key: change.before.originalS3Key,
    ...displayFraming(crop),
  });
  // An original that the re-render made is not needed once the row lets it go
  if (updated && !change.before.originalS3Key)
    await deleteUnusedObjects({ keys: [row.originalS3Key], prefixes: [] }, "restored author original");
  return updated;
}

/** Authors whose only portrait is the legacy photo column, with whether it is in colour. */
export async function scanLegacyAuthorPhotos(): Promise<
  { authorId: string; photoS3Key: string; colour: boolean }[]
> {
  const rows = await db
    .select({ authorId: authors.id, photoS3Key: authors.photoS3Key })
    .from(authors)
    .where(
      and(
        isNotNull(authors.photoS3Key),
        notExists(
          db
            .select({ id: media.id })
            .from(media)
            .where(and(eq(media.authorId, authors.id), eq(media.type, "poster"))),
        ),
      ),
    );
  const scanned = [];
  for (const { authorId, photoS3Key } of rows)
    scanned.push({
      authorId,
      photoS3Key: photoS3Key!,
      colour: !(await isMonochromeImage(await readS3Object(photoS3Key!))),
    });
  return scanned;
}

/** Make a legacy colour portrait a monochrome poster image. Returns its media id. */
export async function importLegacyAuthorPhoto(authorId: string, photoS3Key: string) {
  const row = await ingestMedia({
    owner: { type: "author", id: authorId },
    mediaType: "poster",
    buffer: await readS3Object(photoS3Key),
  });
  return row.id;
}

/** Undo an import: remove the poster image it made, and its files. */
export async function removeImportedAuthorPhoto(mediaId: string) {
  const [row] = await db.delete(media).where(eq(media.id, mediaId)).returning();
  if (!row) return;
  const keys = [row.s3Key, row.thumbnailS3Key, row.uncroppedS3Key, row.originalS3Key];
  await deleteUnusedObjects(
    { keys: keys.filter((k): k is string => !!k), prefixes: [] },
    "undone author portrait import",
  );
}
