import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  artObjects,
  authors,
  commentAttachments,
  comments,
  editions,
  media,
  perfumeVariants,
} from "@/lib/db/schema";
import { s3, S3_BUCKET } from "./client";

/** Every column that stores an S3 key. A key in any of them is still in use. */
export const KEY_COLUMNS = {
  media: ["s3_key", "thumbnail_s3_key", "original_s3_key", "uncropped_s3_key"],
  editions: ["cover_s3_key", "thumbnail_s3_key"],
  authors: ["photo_s3_key"],
  venues: ["poster_s3_key", "thumbnail_s3_key"],
  calibre_books: ["cover_s3_key"],
  comment_attachments: ["s3_key"],
  imports: ["s3_bronze_key", "s3_silver_key"],
} as const;

// Constant identifiers only; the keys themselves are bound parameters.
const IN_USE = sql.raw(
  [
    ...Object.entries(KEY_COLUMNS).map(
      ([table, columns]) =>
        `exists(select 1 from ${table} where k in (${columns.join(", ")}))`,
    ),
    // Calibre ebook files are listed in a JSON array on the book row.
    // Containment is false (not an error) for a row whose formats is not an array.
    `exists(select 1 from calibre_books where formats @> jsonb_build_array(jsonb_build_object('s3Key', k)))`,
  ].join(" or "),
);

/** What a deleted record leaves in the bucket. */
export interface StoredObjects {
  /** Keys its rows stored. Read them before the delete: cascades remove the rows. */
  keys: string[];
  /** Folders that only this record used. Every object under them is a candidate. */
  prefixes: string[];
}

/** Folders each record owns (see keys.ts). The trailing slash stops one id from matching another. */
export const ownedPrefixes = {
  work: (id: string) => [
    `gold/media/work/${id}/`,
    `bronze/media/work/${id}/`,
    `gold/comments/work/${id}/`,
  ],
  author: (id: string) => [
    `gold/media/author/${id}/`,
    `bronze/media/author/${id}/`,
    `gold/comments/author/${id}/`,
  ],
  collection: (id: string) => [
    `gold/media/collection/${id}/`,
    `bronze/media/collection/${id}/`,
  ],
  organization: (id: string) => [
    `gold/media/organization/${id}/`,
    `bronze/media/organization/${id}/`,
  ],
  art_object: (id: string) => [
    `gold/media/art_object/${id}/`,
    `bronze/media/art_object/${id}/`,
  ],
  perfume_variant: (id: string) => [
    `gold/media/perfume_variant/${id}/`,
    `bronze/media/perfume_variant/${id}/`,
  ],
  edition: (id: string) => [
    `gold/covers/${id}/`,
    `silver/covers/${id}/`,
    `bronze/covers/${id}/`,
  ],
  comment: (c: { entityType: string; entityId: string; id: string }) => [
    `gold/comments/${c.entityType}/${c.entityId}/${c.id}/`,
  ],
};

export function keysOf(rows: Record<string, string | null>[]): string[] {
  return rows.flatMap((row) =>
    Object.values(row).filter((key): key is string => !!key),
  );
}

const mediaKeys = {
  s3Key: media.s3Key,
  thumbnailS3Key: media.thumbnailS3Key,
  originalS3Key: media.originalS3Key,
  uncroppedS3Key: media.uncroppedS3Key,
};

function commentFiles(entityType: "work" | "author", entityId: string) {
  return db
    .select({ s3Key: commentAttachments.s3Key })
    .from(commentAttachments)
    .innerJoin(comments, eq(commentAttachments.commentId, comments.id))
    .where(
      and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)),
    );
}

/**
 * A work's images, its editions' covers, its comment files, and the images of
 * its art objects and perfume formulations (which the work's deletion cascades).
 */
export async function workObjects(id: string): Promise<StoredObjects> {
  const [images, covers, files, objects, variants] = await Promise.all([
    db
      .select(mediaKeys)
      .from(media)
      .where(
        or(
          eq(media.workId, id),
          inArray(
            media.artObjectId,
            db.select({ id: artObjects.id }).from(artObjects).where(eq(artObjects.workId, id)),
          ),
          inArray(
            media.perfumeVariantId,
            db
              .select({ id: perfumeVariants.id })
              .from(perfumeVariants)
              .where(eq(perfumeVariants.workId, id)),
          ),
        ),
      ),
    db
      .select({
        id: editions.id,
        coverS3Key: editions.coverS3Key,
        thumbnailS3Key: editions.thumbnailS3Key,
      })
      .from(editions)
      .where(eq(editions.workId, id)),
    commentFiles("work", id),
    db.select({ id: artObjects.id }).from(artObjects).where(eq(artObjects.workId, id)),
    db
      .select({ id: perfumeVariants.id })
      .from(perfumeVariants)
      .where(eq(perfumeVariants.workId, id)),
  ]);
  return {
    keys: keysOf([
      ...images,
      ...covers.map((c) => ({ cover: c.coverS3Key, thumb: c.thumbnailS3Key })),
      ...files,
    ]),
    prefixes: [
      ...ownedPrefixes.work(id),
      ...covers.flatMap((c) => ownedPrefixes.edition(c.id)),
      ...objects.flatMap((o) => ownedPrefixes.art_object(o.id)),
      ...variants.flatMap((v) => ownedPrefixes.perfume_variant(v.id)),
    ],
  };
}

/** The images of one organization, art object or perfume formulation. */
export async function ownedMediaObjects(
  type: "organization" | "art_object" | "perfume_variant",
  id: string,
): Promise<StoredObjects> {
  const column =
    type === "organization"
      ? media.organizationId
      : type === "art_object"
        ? media.artObjectId
        : media.perfumeVariantId;
  const images = await db.select(mediaKeys).from(media).where(eq(column, id));
  return { keys: keysOf(images), prefixes: ownedPrefixes[type](id) };
}

/** An author's images and photo, and (unless a merge moves them) its comment files. */
export async function authorObjects(
  id: string,
  { withComments = true } = {},
): Promise<StoredObjects> {
  const [images, photo, files] = await Promise.all([
    db.select(mediaKeys).from(media).where(eq(media.authorId, id)),
    db
      .select({ photoS3Key: authors.photoS3Key })
      .from(authors)
      .where(eq(authors.id, id)),
    withComments ? commentFiles("author", id) : [],
  ]);
  const prefixes = ownedPrefixes.author(id);
  return {
    keys: keysOf([...images, ...photo, ...files]),
    prefixes: withComments
      ? prefixes
      : prefixes.filter((p) => !p.startsWith("gold/comments/")),
  };
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken,
      }),
    );
    for (const item of page.Contents ?? [])
      if (item.Key?.startsWith(prefix)) keys.push(item.Key);
    ContinuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (ContinuationToken);
  return keys;
}

function textArray(keys: string[]) {
  return sql`ARRAY[${sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  )}]::text[]`;
}

/** The keys, out of these, that some row still stores. */
export async function keysInUse(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const result = await db.execute(
    sql`select k from unnest(${textArray(keys)}) k where ${IN_USE}`,
  );
  const rows = (Array.isArray(result) ? result : result.rows) as {
    k: string;
  }[];
  return new Set(rows.map((row) => row.k));
}

/**
 * Delete what a removed record left in the bucket. Call it only after the
 * database delete commits. A key that any row still stores is kept, and so is
 * every stored key outside gold/. Returns true when some objects remain; the
 * orphan report (scripts/maintenance/report-orphaned-s3.ts) finds them later.
 */
export async function deleteUnusedObjects(
  stored: StoredObjects,
  context: string,
): Promise<boolean> {
  try {
    const keys = new Set(stored.keys.filter((key) => key.startsWith("gold/")));
    for (const prefix of stored.prefixes)
      for (const key of await listKeys(prefix)) keys.add(key);
    const candidates = [...keys];
    let failed = false;
    for (let offset = 0; offset < candidates.length; offset += 1000) {
      const batch = candidates.slice(offset, offset + 1000);
      const inUse = await keysInUse(batch);
      const unused = batch.filter((key) => !inUse.has(key));
      if (!unused.length) continue;
      const response = await s3.send(
        new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: { Objects: unused.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      const errors = new Set(response.Errors?.map((e) => e.Key));
      if (errors.size) {
        failed = true;
        console.error("[s3-cleanup] Objects not deleted", {
          context,
          keys: [...errors],
        });
      }
      // Display settings belong to the image; drop them with it.
      const deleted = unused.filter((key) => !errors.has(key));
      if (deleted.length)
        await db.execute(
          sql`delete from image_adjustments where asset_key = any(${textArray(deleted)})`,
        );
    }
    return failed;
  } catch (error) {
    console.error("[s3-cleanup] Cleanup needs retry", { context }, error);
    return true;
  }
}
