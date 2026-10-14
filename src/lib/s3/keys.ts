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

/**
 * New edition cover attempts (SLN-643) live under gold/media, in a folder the
 * edition owns: gold/media/edition/{editionId}/cover/attempt-{attemptId}/.
 * "edition" is never an image owner (MEDIA_ENTITY_TYPES), so no other record's
 * images share it. Older covers stay where they are, under gold/covers/, and
 * keep working: rows store the full key.
 */
export const EDITION_MEDIA_PREFIX = "gold/media/edition/";
/** Covers written before SLN-643: deterministic and immutable-attempt keys alike. */
export const LEGACY_COVER_PREFIX = "gold/covers/";

const COVER_IDENTITY = /^[a-zA-Z0-9-]{1,128}$/;

/** The edition's own folder under gold/media, for its inventory. */
export function editionMediaPrefix(editionId: string) {
  if (!COVER_IDENTITY.test(editionId)) throw new Error("Invalid cover stage identity");
  return `${EDITION_MEDIA_PREFIX}${editionId}/`;
}

/**
 * A key the edition owns: under its gold/media folder, or its legacy
 * gold/covers folder. Only such a key can be put back as its cover (SLN-638).
 */
export function isOwnEditionCoverKey(editionId: string, key: string) {
  if (!COVER_IDENTITY.test(editionId) || key.split("/").includes("..")) return false;
  return key.startsWith(`${EDITION_MEDIA_PREFIX}${editionId}/`) ||
    key.startsWith(`${LEGACY_COVER_PREFIX}${editionId}/`);
}

/** Fresh immutable catalogue cover attempt; legacy key helpers remain read-compatible. */
export function goldCoverStageKeys(editionId: string, attemptId: string) {
  for (const value of [editionId, attemptId])
    if (!COVER_IDENTITY.test(value))
      throw new Error("Invalid cover stage identity");
  const prefix = `${editionMediaPrefix(editionId)}cover/attempt-${attemptId}/`;
  return { coverKey: `${prefix}cover.webp`, thumbnailKey: `${prefix}thumb.webp` };
}

/**
 * Whether a key is (or may be) an edition cover: every legacy gold/covers key
 * and anything in an edition's gold/media folder. It is deliberately broad
 * there, since a cover it recognises is retained and never reprocessed;
 * other records' images and e-book files are not covers.
 */
export function isEditionCoverKey(key: string): boolean {
  return key.startsWith(LEGACY_COVER_PREFIX) || key.startsWith(EDITION_MEDIA_PREFIX);
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
