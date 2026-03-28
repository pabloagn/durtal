"use client";

import { useRouter } from "next/navigation";
import { UploadZone } from "@/components/media/upload-zone";
import { MediaGallery } from "@/components/media/media-gallery";
import type { Media } from "@/lib/types";

interface AuthorMediaSectionProps {
  authorId: string;
  gallery: Media[];
  hasPoster: boolean;
  hasBackground: boolean;
}

export function AuthorMediaSection({
  authorId,
  gallery,
  hasPoster,
  hasBackground,
}: AuthorMediaSectionProps) {
  const router = useRouter();
  const refresh = () => router.refresh();

  const getImageUrl = (s3Key: string) =>
    `/api/s3/read?key=${encodeURIComponent(s3Key)}`;

  return (
    <>
      {(!hasPoster || !hasBackground) && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-sm text-fg-secondary">
            Media
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {!hasPoster && (
              <UploadZone
                entityType="author"
                entityId={authorId}
                mediaType="poster"
                onUploadComplete={refresh}
              />
            )}
            {!hasBackground && (
              <UploadZone
                entityType="author"
                entityId={authorId}
                mediaType="background"
                onUploadComplete={refresh}
              />
            )}
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-serif text-sm text-fg-secondary">
          Gallery
          {gallery.length > 0 && (
            <span className="ml-1 text-fg-muted">({gallery.length})</span>
          )}
        </h2>
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
          entityType="author"
          entityId={authorId}
          mediaType="gallery"
          onUploadComplete={refresh}
          multiple
          className="mt-3"
        />
      </section>
    </>
  );
}
