import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { s3, S3_BUCKET } from "./client";

/** Only this collection's namespaces are eligible. Never delete borrowed book/author artwork. */
export async function cleanupCollectionArtwork(
  id: string,
  storedKeys: string[],
): Promise<boolean> {
  const prefixes = [
    `gold/media/collection/${id}/`,
    `bronze/media/collection/${id}/`,
  ];
  try {
    const keys = new Set(
      storedKeys.filter((key) =>
        prefixes.some((prefix) => key.startsWith(prefix)),
      ),
    );
    for (const Prefix of prefixes) {
      let ContinuationToken: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({
            Bucket: S3_BUCKET,
            Prefix,
            ContinuationToken,
          }),
        );
        for (const item of page.Contents ?? [])
          if (item.Key?.startsWith(Prefix)) keys.add(item.Key);
        ContinuationToken = page.IsTruncated
          ? page.NextContinuationToken
          : undefined;
      } while (ContinuationToken);
    }
    if (!keys.size) return false;
    const values = sql`ARRAY[${sql.join(
      [...keys].map((key) => sql`${key}`),
      sql`, `,
    )}]::text[]`;
    const result = await db.execute(sql`select k from unnest(${values}) k where
      exists(select 1 from media where k in(s3_key,thumbnail_s3_key,original_s3_key)) or
      exists(select 1 from collections where k in(cover_s3_key,poster_s3_key,poster_thumbnail_s3_key,background_s3_key)) or
      exists(select 1 from editions where k in(cover_s3_key,thumbnail_s3_key)) or
      exists(select 1 from authors where k=photo_s3_key) or
      exists(select 1 from venues where k in(poster_s3_key,thumbnail_s3_key)) or
      exists(select 1 from calibre_books where k=cover_s3_key) or
      exists(select 1 from comment_attachments where k=s3_key)`);
    const references = (Array.isArray(result) ? result : result.rows) as {
      k: string;
    }[];
    const protectedKeys = new Set(references.map((row) => row.k));
    const deletable = [...keys].filter((key) => !protectedKeys.has(key));
    let failed = false;
    for (let offset = 0; offset < deletable.length; offset += 1000) {
      const batch = deletable.slice(offset, offset + 1000);
      const response = await s3.send(
        new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
      const errors = new Set(response.Errors?.map((e) => e.Key));
      failed ||= errors.size > 0;
      const deleted = batch.filter((key) => !errors.has(key));
      if (deleted.length)
        await db.execute(
          sql`delete from image_adjustments where asset_key=any(ARRAY[${sql.join(
            deleted.map((key) => sql`${key}`),
            sql`, `,
          )}]::text[])`,
        );
    }
    return failed;
  } catch {
    console.error("Collection artwork cleanup needs retry", id);
    return true;
  }
}
