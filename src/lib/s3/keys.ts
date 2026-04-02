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

// ── Media (work/author/collection posters, backgrounds, galleries) ──────────

export type MediaEntityType = "work" | "author" | "collection";

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
