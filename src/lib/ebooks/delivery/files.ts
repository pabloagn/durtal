import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { ebookFiles, ebooks } from "@/lib/db/schema";
import { medallionOf } from "../medallion";
import { coverKeySha256, isDeliveryFileKey, parseStageKey } from "../keys";

/*
 * What delivery may hand out (SLN-491). Only these readers make the types
 * that sign.ts and url.ts take, so nothing can sign or serve a key that was
 * not read from the catalogue in the same request: never a key a client
 * sent, and never one remembered from an earlier request.
 */

declare const fromCatalogue: unique symbol;

/** One ebook_files row, as read for this request */
export interface CatalogueFile {
  readonly id: string;
  readonly ebookId: string;
  readonly sha256: string;
  readonly s3Key: string;
  readonly format: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly status: "stored" | "verified" | "missing" | "quarantined" | "replaced";
  readonly drm: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly [fromCatalogue]: true;
}

/** An e-book's cover, as read for this request: the checksum of the file whose derived covers it uses */
export interface CatalogueCover {
  readonly ebookId: string;
  /** Null when no cover was made */
  readonly sha256: string | null;
  readonly key?: string;
  readonly [fromCatalogue]: true;
}

/**
 * Whether a file may be served or signed: stored or verified, with no DRM.
 * Quarantined, missing, replaced and DRM files never leave the bucket.
 */
export function isDeliverable(file: Pick<CatalogueFile, "drm" | "s3Key" | "sha256" | "format" | "metadata"> & { status: string }): boolean {
  const stages = medallionOf(file.metadata);
  return (
    (file.status === "stored" || file.status === "verified") && !file.drm &&
    isDeliveryFileKey(file.s3Key, file.sha256, file.format) &&
    (!parseStageKey(file.s3Key) ||
      (!!stages?.validation.downloadable &&
        stages.validation.integrity === "verified" &&
        stages.validation.drm === "clear" &&
        stages.gold.some((object) => object.key === file.s3Key && object.sha256 === file.sha256)))
  );
}

/** One file row, or null when there is none */
export async function readCatalogueFile(fileId: string): Promise<CatalogueFile | null> {
  const [row] = await db
    .select({
      id: ebookFiles.id,
      ebookId: ebookFiles.ebookId,
      sha256: ebookFiles.sha256,
      s3Key: ebookFiles.s3Key,
      format: ebookFiles.format,
      sizeBytes: ebookFiles.sizeBytes,
      contentType: ebookFiles.contentType,
      status: ebookFiles.status,
      drm: ebookFiles.drm,
      metadata: ebookFiles.metadata,
    })
    .from(ebookFiles)
    .where(eq(ebookFiles.id, fileId))
    .limit(1);
  return row ? (row as CatalogueFile) : null;
}

/**
 * An e-book's cover, or null when there is no such e-book. The cover is the
 * preferred file's (its cover_key), else the e-book's own cover_key; only a
 * key shaped exactly as keys.ts builds it counts.
 */
export async function readCatalogueCover(ebookId: string): Promise<CatalogueCover | null> {
  const [row] = await db
    .select({ id: ebooks.id, coverKey: ebooks.coverKey, fileCoverKey: ebookFiles.coverKey, metadata: ebookFiles.metadata, status: ebookFiles.status, drm: ebookFiles.drm })
    .from(ebooks)
    .leftJoin(ebookFiles, eq(ebookFiles.id, ebooks.preferredFileId))
    .where(eq(ebooks.id, ebookId))
    .limit(1);
  if (!row) return null;
  for (const key of [row.fileCoverKey, row.coverKey]) {
    if (!key) continue;
    const parsed = parseStageKey(key);
    if (parsed && !(row.status === "stored" || row.status === "verified")) continue;
    if (parsed && (row.drm || !medallionOf(row.metadata)?.gold.some((o) => o.key === key))) continue;
    const sha256 = parsed?.stage === "gold" && parsed.kind === "derived" && parsed.name?.startsWith("cover-") ? parsed.sha256 : coverKeySha256(key);
    if (sha256) return { ebookId: row.id, sha256, key } as CatalogueCover;
  }
  return { ebookId: row.id, sha256: null } as CatalogueCover;
}

/** The newest file that may be served, for the settings check; null when none is stored */
export async function readNewestDeliverableFile(): Promise<CatalogueFile | null> {
  const [row] = await db
    .select({ id: ebookFiles.id })
    .from(ebookFiles)
    .where(and(inArray(ebookFiles.status, ["stored", "verified"]), isNull(ebookFiles.drm)))
    .orderBy(desc(ebookFiles.createdAt))
    .limit(1);
  return row ? readCatalogueFile(row.id) : null;
}

/** The newest e-book with a cover, for the settings check; null when none has one */
export async function readNewestCatalogueCover(): Promise<CatalogueCover | null> {
  const [row] = await db
    .select({ id: ebooks.id })
    .from(ebooks)
    .where(isNotNull(ebooks.coverKey))
    .orderBy(desc(ebooks.createdAt))
    .limit(1);
  const cover = row ? await readCatalogueCover(row.id) : null;
  return cover?.sha256 ? cover : null;
}
