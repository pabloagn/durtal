"use client";

import { useRouter } from "next/navigation";
import { UploadZone } from "@/components/media/upload-zone";
import { DEFAULT_MONOCHROME_PARAMS } from "@/lib/validations/media";
import type { Media } from "@/lib/types";
import { SectionHeading } from "@/components/shared/section-heading";

interface AuthorMediaSectionProps {
  authorId: string;
  /** Retained for compatibility; no longer used for display — handled by GallerySection */
  gallery: Media[];
}

export function AuthorMediaSection({ authorId }: AuthorMediaSectionProps) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <>
      {/* Upload zones for poster and background */}
      <section className="mb-8">
        <SectionHeading title="Media" />
        <div className="grid grid-cols-2 gap-3">
          <UploadZone
            entityType="author"
            entityId={authorId}
            mediaType="poster"
            onUploadComplete={refresh}
            processingParams={DEFAULT_MONOCHROME_PARAMS}
          />
          <UploadZone
            entityType="author"
            entityId={authorId}
            mediaType="background"
            onUploadComplete={refresh}
            processingParams={DEFAULT_MONOCHROME_PARAMS}
          />
        </div>
      </section>

      {/* Gallery upload zone */}
      <section className="mb-4">
        <SectionHeading title="Gallery Upload" />
        <UploadZone
          entityType="author"
          entityId={authorId}
          mediaType="gallery"
          onUploadComplete={refresh}
          multiple
          processingParams={DEFAULT_MONOCHROME_PARAMS}
        />
      </section>
    </>
  );
}
