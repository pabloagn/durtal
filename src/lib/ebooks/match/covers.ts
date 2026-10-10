import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { uploadToS3, deleteFromS3 } from "@/lib/s3/covers";
import { extractColorPalette } from "@/lib/color/extract-palette";
import { getEbookObjectRange, headEbookObject } from "../storage";
import { acceptedPublication } from "../publication-evidence";
import { matchFileFromStoredRow, type LoadedMatchCatalogue } from "./load";
import type { ColorPalette } from "@/lib/types";

export interface CoverCopyPlan {
  editionId: string;
  sourceKey: string;
  sourceSha256: string | null;
  sourceSize: number | null;
  coverKey: string;
  thumbnailKey: string;
}
export interface CopiedCover {
  coverKey: string;
  thumbnailKey: string;
  palette: ColorPalette | null;
}
/** Pure allocation only; source ownership and strict publication lineage were
 * read in the protected callback. No external URL is used for eBook covers. */
export function planCoverCopy(
  snapshot: Pick<LoadedMatchCatalogue, "rows">,
  ebookId: string,
  editionId: string,
  sourceKey: string | null,
): CoverCopyPlan | null {
  if (!sourceKey) return null;
  const row = snapshot.rows.ebook_files.find(
    (row) =>
      row.ebook_id === ebookId &&
      row.cover_key === sourceKey &&
      matchFileFromStoredRow(row).coverKey === sourceKey,
  );
  if (!row)
    throw new Error("Cover source does not belong to the validated ebook");
  const publication = acceptedPublication(row.metadata, {
    sha256: String(row.sha256),
    format: String(row.format),
    sizeBytes: Number(row.size_bytes),
    s3Key: String(row.s3_key),
    manifestKey: typeof row.manifest_key === "string" ? row.manifest_key : null,
  });
  const object = publication?.gold.find((object) => object.key === sourceKey);
  const attemptId = randomUUID();
  return {
    editionId,
    sourceKey,
    sourceSha256: object?.sha256 ?? null,
    sourceSize: object?.size ?? null,
    coverKey: `gold/covers/${editionId}/matching-${attemptId}/cover.webp`,
    thumbnailKey: `gold/covers/${editionId}/matching-${attemptId}/thumb.webp`,
  };
}
/** Runs after planning and undo reservation, never inside a read-only callback.
 * Unique attempt keys prevent failed/repeated applies from deleting another
 * successful operation's cover. Source bytes are bounded and hash checked. */
export async function copyPlannedCover(
  plan: CoverCopyPlan,
): Promise<CopiedCover> {
  const head = await headEbookObject(plan.sourceKey, { checksum: true });
  if (
    !head ||
    head.size <= 0 ||
    head.size > 20 * 1024 * 1024 ||
    (plan.sourceSize !== null && head.size !== plan.sourceSize)
  )
    throw new Error("The validated cover is missing or its size changed");
  const expected = plan.sourceSha256 ?? head.sha256 ?? head.metadataSha256;
  if (
    !expected ||
    (plan.sourceSha256 && head.sha256 && head.sha256 !== plan.sourceSha256)
  )
    throw new Error(
      "The validated cover checksum changed or cannot be verified",
    );
  const object = await getEbookObjectRange(plan.sourceKey, 0, head.size - 1);
  if (!object || object.length !== head.size)
    throw new Error("The cover bytes are incomplete");
  const reader = object.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > head.size)
        throw new Error("The cover exceeded its declared size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (
    size !== head.size ||
    createHash("sha256").update(bytes).digest("hex") !== expected
  )
    throw new Error("The validated cover bytes changed");
  const sharp = (await import("sharp")).default;
  const cover = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: 100_000_000,
  })
    .rotate()
    .resize(1200, 1800, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  const thumbnail = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: 100_000_000,
  })
    .rotate()
    .resize(600, 900, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  await uploadToS3(plan.coverKey, cover, "image/webp");
  await uploadToS3(plan.thumbnailKey, thumbnail, "image/webp");
  return {
    coverKey: plan.coverKey,
    thumbnailKey: plan.thumbnailKey,
    palette: await extractColorPalette(thumbnail).catch(() => null),
  };
}
/** An uncertain database response may have committed. Retain assets when a
 * row references them or the follow-up read fails; only proven unused keys
 * belonging to this unique attempt are cleaned up. */
export async function discardUnusedCover(
  conn: Db,
  plan: CoverCopyPlan,
): Promise<void> {
  const rows = resultRows<{ used: boolean }>(
    await conn.execute(
      sql`select exists(select 1 from editions where cover_s3_key=any(${[plan.coverKey, plan.thumbnailKey]}::text[]) or thumbnail_s3_key=any(${[plan.coverKey, plan.thumbnailKey]}::text[])) as used`,
    ),
  );
  if (rows[0]?.used !== false) return;
  await Promise.all([
    deleteFromS3(plan.coverKey),
    deleteFromS3(plan.thumbnailKey),
  ]);
}
