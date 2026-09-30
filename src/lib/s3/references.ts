import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { s3, S3_BUCKET } from "./client";

/** The subset of `keys` that a database row still uses. */
export async function referencedS3Keys(keys: string[]): Promise<Set<string>> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return new Set();
  const values = sql`ARRAY[${sql.join(
    unique.map((key) => sql`${key}`),
    sql`, `,
  )}]::text[]`;
  const result = await db.execute(sql`select k from unnest(${values}) k where
    exists(select 1 from media where k in(s3_key,thumbnail_s3_key,original_s3_key,uncropped_s3_key)) or
    exists(select 1 from editions where k in(cover_s3_key,thumbnail_s3_key)) or
    exists(select 1 from authors where k=photo_s3_key) or
    exists(select 1 from venues where k in(poster_s3_key,thumbnail_s3_key)) or
    exists(select 1 from calibre_books where k=cover_s3_key) or
    exists(select 1 from comment_attachments where k=s3_key)`);
  const rows = (Array.isArray(result) ? result : result.rows) as { k: string }[];
  return new Set(rows.map((row) => row.k));
}

/**
 * Delete the objects no database row uses, with their display settings.
 * Keys that a row still uses are kept. Returns false when a delete failed.
 */
export async function deleteUnreferencedS3Keys(keys: string[]): Promise<boolean> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return true;
  const kept = await referencedS3Keys(unique);
  const deletable = unique.filter((key) => !kept.has(key));
  let ok = true;
  for (let offset = 0; offset < deletable.length; offset += 1000) {
    const batch = deletable.slice(offset, offset + 1000);
    const response = await s3.send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
    const errors = new Set(response.Errors?.map((e) => e.Key));
    ok &&= errors.size === 0;
    const deleted = batch.filter((key) => !errors.has(key));
    if (deleted.length)
      await db.execute(
        sql`delete from image_adjustments where asset_key=any(ARRAY[${sql.join(
          deleted.map((key) => sql`${key}`),
          sql`, `,
        )}]::text[])`,
      );
  }
  return ok;
}
