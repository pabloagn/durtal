import type { MediaEntityType } from "@/lib/s3/keys";
import type { MediaType } from "@/lib/types";

/** Media owner columns for a create call: exactly one of work, author or collection. */
export function mediaOwnerFields(
  entityType: MediaEntityType,
  entityId: string,
) {
  if (entityType === "work") return { workId: entityId };
  if (entityType === "author") return { authorId: entityId };
  return { collectionId: entityId };
}

/** Collections carry a poster and a background; galleries are for works and authors. */
export function supportsMediaType(
  entityType: MediaEntityType,
  mediaType: MediaType,
): boolean {
  return entityType !== "collection" || mediaType !== "gallery";
}

export function isMediaEntityType(value: unknown): value is MediaEntityType {
  return value === "work" || value === "author" || value === "collection";
}
