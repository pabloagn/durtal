import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ebookFiles, ebooks } from "@/lib/db/schema";
import { coverKeySha256 } from "../keys";

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
  readonly [fromCatalogue]: true;
}

/** An e-book's cover, as read for this request: the checksum of the file whose derived covers it uses */
export interface CatalogueCover {
  readonly ebookId: string;
  /** Null when no cover was made */
  readonly sha256: string | null;
  readonly [fromCatalogue]: true;
}

/**
 * Whether a file may be served or signed: stored or verified, with no DRM.
 * Quarantined, missing, replaced and DRM files never leave the bucket.
 */
export function isDeliverable(file: Pick<CatalogueFile, "status" | "drm">): boolean {
  return (file.status === "stored" || file.status === "verified") && !file.drm;
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
    .select({ id: ebooks.id, coverKey: ebooks.coverKey, fileCoverKey: ebookFiles.coverKey })
    .from(ebooks)
    .leftJoin(ebookFiles, eq(ebookFiles.id, ebooks.preferredFileId))
    .where(eq(ebooks.id, ebookId))
    .limit(1);
  if (!row) return null;
  const sha256 = coverKeySha256(row.fileCoverKey) ?? coverKeySha256(row.coverKey);
  return { ebookId: row.id, sha256 } as CatalogueCover;
}
