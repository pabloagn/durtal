/** Medallion architecture path helpers for S3 */

// ── Bronze (raw, unprocessed) ────────────────────────────────────────────────

export function bronzeImportKey(importId: string, filename: string) {
  return `bronze/imports/${importId}/${filename}`;
}

export function bronzeCoverKey(editionId: string, ext: string) {
  return `bronze/covers/${editionId}/original.${ext}`;
}

export function bronzeUploadKey(uploadId: string, filename: string) {
  return `bronze/uploads/${uploadId}/${filename}`;
}

/**
 * Evidence: private copies of fetched pages and their stored text (SLN-468),
 * named by content hash so two owners share one object. Never served, never
 * exported and never in a record's owned folders (docs/07).
 */
export const EVIDENCE_PREFIX = "bronze/evidence/";

/** A fetched page, gzipped, named by the sha256 of its raw bytes */
export function evidenceRawKey(rawSha256: string) {
  return `${EVIDENCE_PREFIX}${rawSha256}.raw.gz`;
}

/** The stored main text, UTF-8, named by its sha256 */
export function evidenceTextKey(textSha256: string) {
  return `${EVIDENCE_PREFIX}${textSha256}.txt`;
}

// ── Silver (parsed, validated) ───────────────────────────────────────────────

export function silverImportParsedKey(importId: string) {
  return `silver/imports/${importId}/parsed.json`;
}

export function silverImportConflictsKey(importId: string) {
  return `silver/imports/${importId}/conflicts.json`;
}

export function silverImportErrorsKey(importId: string) {
  return `silver/imports/${importId}/errors.json`;
}

export function silverCoverKey(editionId: string, ext: string) {
  return `silver/covers/${editionId}/validated.${ext}`;
}

// ── Gold (production-ready) ──────────────────────────────────────────────────

export function goldCoverKey(editionId: string) {
  return `gold/covers/${editionId}/cover.webp`;
}

export function goldThumbnailKey(editionId: string) {
  return `gold/covers/${editionId}/thumb.webp`;
}

export function goldExportKey(exportId: string) {
  return `gold/exports/${exportId}/library_export.csv`;
}

// ── Media (posters, backgrounds and galleries of every image owner) ─────────

/** Records that own images. Each has its own folder under bronze/ and gold/. */
export const MEDIA_ENTITY_TYPES = [
  "work",
  "author",
  "collection",
  "organization",
  "art_object",
  "perfume_variant",
] as const;
export type MediaEntityType = (typeof MEDIA_ENTITY_TYPES)[number];

export function bronzeMediaKey(
  entityType: MediaEntityType,
  entityId: string,
  fileId: string,
  ext: string,
) {
  return `bronze/media/${entityType}/${entityId}/${fileId}.${ext}`;
}

export function goldMediaKey(
  entityType: MediaEntityType,
  entityId: string,
  mediaType: string,
  fileId: string,
) {
  return `gold/media/${entityType}/${entityId}/${mediaType}/${fileId}.webp`;
}

export function goldMediaThumbnailKey(
  entityType: MediaEntityType,
  entityId: string,
  mediaType: string,
  fileId: string,
) {
  return `gold/media/${entityType}/${entityId}/${mediaType}/${fileId}_thumb.webp`;
}

export function goldMediaOriginalKey(
  entityType: MediaEntityType,
  entityId: string,
  mediaType: string,
  fileId: string,
) {
  return `gold/media/${entityType}/${entityId}/${mediaType}/${fileId}_original.webp`;
}

/**
 * Keys for a new version of a media item's display files. Each version gets
 * fresh keys, so no stored object is overwritten and no browser shows a
 * cached older version.
 */
export function goldMediaVersionKeys(
  entityType: MediaEntityType,
  entityId: string,
  mediaType: string,
  mediaId: string,
  version: string,
) {
  const base = `gold/media/${entityType}/${entityId}/${mediaType}/${mediaId}_${version}`;
  return {
    full: `${base}.webp`,
    thumbnail: `${base}_thumb.webp`,
    uncropped: `${base}_uncropped.webp`,
  };
}

// ── Comment attachments ─────────────────────────────────────────────────────

export function goldCommentAttachmentKey(
  entityType: string,
  entityId: string,
  commentId: string,
  fileId: string,
  ext: string,
) {
  return `gold/comments/${entityType}/${entityId}/${commentId}/${fileId}.${ext}`;
}
