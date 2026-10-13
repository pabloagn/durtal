/**
 * An edition's cover, set on its own (SLN-638): a chosen or dropped file, an
 * image address, the book's cover, or the edition's previous own cover again.
 *
 * Every change is one guarded write: it refuses when the edition changed
 * after it was read. New images are immutable attempts under the edition's
 * folder, published only when the write commits. No change deletes an image:
 * an own cover the edition stops using stays stored, so it can be put back.
 */
import { createHash } from "node:crypto";
import { atomic } from "@/lib/db/atomic";
import { db } from "@/lib/db";
import { editions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readableDatabaseError } from "@/lib/db/errors";
import { STALE_RECORD } from "@/lib/catalogue/work-store";
import { parseId } from "@/lib/validations/helpers";
import {
  readEditionWriteSnapshot,
  editionWriteGuardQueries,
  editionUpdateQuery,
  type EditionWriteSnapshot,
} from "@/lib/catalogue/edition-write-guard";
import {
  allocateCoverStage,
  renderCoverPair,
  stageCoverPair,
  requireVerifiedCover,
  retainCoverAttempt,
  type VerifiedCoverStage,
} from "@/lib/s3/cover-stage";
import { processAndUploadCover, getS3Object } from "@/lib/s3/covers";
import { isOwnEditionCoverKey } from "@/lib/s3/keys";
import { editionCoverPaletteFields } from "@/lib/color/color-buckets";
import { extractColorPalette } from "@/lib/color/extract-palette";
import { recordActivity } from "@/lib/activity/record";

/** The edition's own cover keys, as they were before a change */
export interface OwnCover {
  coverS3Key: string | null;
  thumbnailS3Key: string | null;
  coverSourceUrl: string | null;
}

export type CoverInput =
  | { kind: "file"; bytes: Buffer }
  | { kind: "url"; url: string };

export const COVER_CHANGED =
  "This edition's cover changed in the meantime. Reload and try again.";
export const COVER_UNREADABLE =
  "This image could not be read. Try another file or address.";
const NOT_RESTORABLE = "That cover can no longer be put back.";
/** Largest stored image read back to restore a cover's colours */
const MAX_RESTORE_BYTES = 20 * 1024 * 1024;

function ownCover(snapshot: EditionWriteSnapshot): OwnCover {
  const row = (JSON.parse(snapshot.state) as {
    edition: { cover_s3_key: string | null; thumbnail_s3_key: string | null; cover_source_url: string | null };
  }).edition;
  return {
    coverS3Key: row.cover_s3_key,
    thumbnailS3Key: row.thumbnail_s3_key,
    coverSourceUrl: row.cover_source_url,
  };
}

/** One guarded write of the edition's cover columns */
async function writeCover(
  id: string,
  expected: EditionWriteSnapshot,
  updates: Record<string, unknown>,
) {
  await atomic((d) => [
    ...editionWriteGuardQueries(d, expected),
    editionUpdateQuery(d, id, { ...updates, updatedAt: new Date() }),
  ]).catch((error) => {
    const readable = readableDatabaseError(error);
    throw readable instanceof Error && readable.message === STALE_RECORD
      ? new Error(COVER_CHANGED, { cause: error })
      : readable;
  });
  const row = await db.query.editions.findFirst({
    where: eq(editions.id, id),
    columns: { workId: true },
  });
  if (row) recordActivity("work", row.workId, "work.edition_updated", { targetId: id });
}

async function stageFile(editionId: string, bytes: Buffer): Promise<VerifiedCoverStage> {
  const allocation = allocateCoverStage({
    editionId,
    source: {
      kind: "upload",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    },
  });
  try {
    const { buffers, palette } = await renderCoverPair(bytes);
    return await stageCoverPair(allocation, buffers, palette);
  } catch (error) {
    retainCoverAttempt(allocation, "upload rendering or stage outcome uncertain");
    throw new Error(COVER_UNREADABLE, { cause: error });
  }
}

/** A new own cover for the edition. Returns the own cover it replaced. */
export async function replaceEditionCover(
  editionId: string,
  input: CoverInput,
): Promise<{ previous: OwnCover }> {
  parseId(editionId);
  const expected = await readEditionWriteSnapshot(editionId);
  const stage =
    input.kind === "file"
      ? await stageFile(editionId, input.bytes)
      : await processAndUploadCover(editionId, input.url);
  if (!stage) throw new Error(COVER_UNREADABLE);
  requireVerifiedCover(stage, editionId);
  try {
    await writeCover(editionId, expected, {
      coverS3Key: stage.coverKey,
      thumbnailS3Key: stage.thumbnailKey,
      coverSourceUrl: input.kind === "url" ? input.url : null,
      ...editionCoverPaletteFields(stage.palette),
    });
  } catch (error) {
    retainCoverAttempt(stage, "edition cover publication rejected or uncertain");
    throw error;
  }
  return { previous: ownCover(expected) };
}

/**
 * The edition shows the book's cover from now on, and follows it when it
 * changes. Its own cover stays stored. Returns that own cover, or null when
 * the edition had none.
 */
export async function switchToBookCover(editionId: string): Promise<{ previous: OwnCover | null }> {
  parseId(editionId);
  const expected = await readEditionWriteSnapshot(editionId);
  const previous = ownCover(expected);
  if (!previous.coverS3Key && !previous.thumbnailS3Key) return { previous: null };
  await writeCover(editionId, expected, {
    coverS3Key: null,
    thumbnailS3Key: null,
    coverSourceUrl: null,
    ...editionCoverPaletteFields(null),
  });
  return { previous };
}

/** Whether an own cover can be put back: every key is the edition's own */
export function isRestorableCover(editionId: string, cover: OwnCover) {
  const keys = [cover.coverS3Key, cover.thumbnailS3Key];
  return keys.some(Boolean) &&
    keys.every((key) => key === null || isOwnEditionCoverKey(editionId, key));
}

async function storedBytes(key: string): Promise<Buffer> {
  const object = await getS3Object(key).catch((error) => {
    throw new Error(NOT_RESTORABLE, { cause: error });
  });
  if (!object.body || (object.contentLength ?? 0) > MAX_RESTORE_BYTES)
    throw new Error(NOT_RESTORABLE);
  const bytes = Buffer.from(await object.body.transformToByteArray());
  if (!bytes.length || bytes.length > MAX_RESTORE_BYTES) throw new Error(NOT_RESTORABLE);
  return bytes;
}

/**
 * Put back an own cover the edition used before, while it still shows the
 * book's cover. Only the edition's own stored images qualify.
 */
export async function restoreEditionCover(editionId: string, cover: OwnCover): Promise<void> {
  parseId(editionId);
  if (!isRestorableCover(editionId, cover)) throw new Error(NOT_RESTORABLE);
  const expected = await readEditionWriteSnapshot(editionId);
  const current = ownCover(expected);
  if (current.coverS3Key || current.thumbnailS3Key) throw new Error(COVER_CHANGED);
  // Every image must still be stored; the colours come from the smaller one
  const keys = [...new Set([cover.thumbnailS3Key, cover.coverS3Key])].filter(
    (key): key is string => !!key,
  );
  const [smallest] = await Promise.all(keys.map(storedBytes));
  const palette = await extractColorPalette(smallest).catch(() => null);
  await writeCover(editionId, expected, {
    coverS3Key: cover.coverS3Key,
    thumbnailS3Key: cover.thumbnailS3Key,
    coverSourceUrl: cover.coverSourceUrl,
    ...editionCoverPaletteFields(palette),
  });
}
