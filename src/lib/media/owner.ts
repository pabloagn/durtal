import { media } from "@/lib/db/schema";
import { MEDIA_ENTITY_TYPES, type MediaEntityType } from "@/lib/s3/keys";
import type { MediaType } from "@/lib/types";

/** The media column that names each kind of owner. */
export const MEDIA_OWNER_COLUMN = {
  work: media.workId,
  author: media.authorId,
  collection: media.collectionId,
  organization: media.organizationId,
  art_object: media.artObjectId,
  perfume_variant: media.perfumeVariantId,
} as const satisfies Record<MediaEntityType, unknown>;

/** The owner of a stored media row. */
export function mediaOwnerOf(row: {
  workId: string | null;
  authorId: string | null;
  collectionId: string | null;
  organizationId: string | null;
  artObjectId: string | null;
  perfumeVariantId: string | null;
}): { type: MediaEntityType; id: string } {
  if (row.workId) return { type: "work", id: row.workId };
  if (row.authorId) return { type: "author", id: row.authorId };
  if (row.collectionId) return { type: "collection", id: row.collectionId };
  if (row.organizationId)
    return { type: "organization", id: row.organizationId };
  if (row.artObjectId) return { type: "art_object", id: row.artObjectId };
  return { type: "perfume_variant", id: row.perfumeVariantId! };
}

/** Media owner columns for a create call: exactly one owner. */
export function mediaOwnerFields(
  entityType: MediaEntityType,
  entityId: string,
) {
  switch (entityType) {
    case "work":
      return { workId: entityId };
    case "author":
      return { authorId: entityId };
    case "collection":
      return { collectionId: entityId };
    case "organization":
      return { organizationId: entityId };
    case "art_object":
      return { artObjectId: entityId };
    case "perfume_variant":
      return { perfumeVariantId: entityId };
  }
}

/**
 * Collections carry a poster and a background. Organizations, art objects and
 * perfume formulations carry a poster and gallery images, never a background.
 * The database enforces the same rule (media_type_check).
 */
export function supportsMediaType(
  entityType: MediaEntityType,
  mediaType: MediaType,
): boolean {
  if (entityType === "collection") return mediaType !== "gallery";
  if (
    entityType === "organization" ||
    entityType === "art_object" ||
    entityType === "perfume_variant"
  )
    return mediaType !== "background";
  return true;
}

export function isMediaEntityType(value: unknown): value is MediaEntityType {
  return (MEDIA_ENTITY_TYPES as readonly unknown[]).includes(value);
}
