import { getGalleryWithLayout } from "@/lib/actions/gallery-layouts";
import { GallerySectionClient } from "./gallery-section-client";

interface GallerySectionProps {
  entityType: "work" | "author";
  entityId: string;
  title?: string;
}

/**
 * Server component: fetches gallery media + layout, then delegates rendering
 * to the client wrapper which handles lightbox and randomize interactions.
 */
export async function GallerySection({
  entityType,
  entityId,
  title = "Gallery",
}: GallerySectionProps) {
  const { mediaItems, layout } = await getGalleryWithLayout(
    entityType,
    entityId,
  );

  if (mediaItems.length === 0) return null;

  // Build lightbox image list ordered by block iteration
  const orderedIds = layout.blocks.flatMap((b) =>
    b.cells.map((c) => c.mediaId),
  );
  const mediaMap = new Map(mediaItems.map((m) => [m.id, m]));
  const ordered = orderedIds
    .map((id) => mediaMap.get(id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  // Serialize only what the client needs (avoid passing non-serializable refs)
  const serializedMedia = ordered.map((m) => ({
    id: m.id,
    s3Key: m.s3Key,
    thumbnailS3Key: m.thumbnailS3Key,
    caption: m.caption,
    originalFilename: m.originalFilename,
    width: m.width,
    height: m.height,
    sortOrder: m.sortOrder,
  }));

  return (
    <GallerySectionClient
      entityType={entityType}
      entityId={entityId}
      initialLayout={layout}
      mediaItems={serializedMedia}
      title={title}
    />
  );
}
