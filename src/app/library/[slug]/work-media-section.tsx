"use client";

import { useRouter } from "next/navigation";
import { UploadZone } from "@/components/media/upload-zone";
import { MediaGallery } from "@/components/media/media-gallery";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import type { Media } from "@/lib/types";
import { SectionHeading } from "@/components/shared/section-heading";

interface WorkMediaSectionProps {
  workId: string;
  gallery: Media[];
  hasPoster: boolean;
  hasBackground: boolean;
}

export function WorkMediaSection({
  workId,
  gallery,
  hasPoster,
  hasBackground,
}: WorkMediaSectionProps) {
  const router = useRouter();
  const refresh = () => {
    router.refresh();
    triggerActivityRefresh();
  };

  const getImageUrl = (s3Key: string) =>
    `/api/s3/read?key=${encodeURIComponent(s3Key)}`;

  return (
    <>
      {/* Upload zones for poster and background */}
      {(!hasPoster || !hasBackground) && (
        <section className="mb-8">
          <SectionHeading title="Media" />
          <div className="grid grid-cols-2 gap-3">
            {!hasPoster && (
              <UploadZone
                entityType="work"
                entityId={workId}
                mediaType="poster"
                onUploadComplete={refresh}
              />
            )}
            {!hasBackground && (
              <UploadZone
                entityType="work"
                entityId={workId}
                mediaType="background"
                onUploadComplete={refresh}
              />
            )}
          </div>
        </section>
      )}

      {/* Gallery */}
      <section className="mb-8">
        <SectionHeading
          title="Gallery"
          count={gallery.length > 0 ? gallery.length : undefined}
        />
        <MediaGallery
          media={gallery}
          editable
          getImageUrl={getImageUrl}
          onDelete={async (id) => {
            await fetch(`/api/media/${id}`, { method: "DELETE" });
            refresh();
          }}
        />
        <UploadZone
          entityType="work"
          entityId={workId}
          mediaType="gallery"
          onUploadComplete={refresh}
          multiple
          className="mt-3"
        />
      </section>
    </>
  );
}
