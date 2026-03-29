"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import type { Media } from "@/lib/types";
import { Lightbox } from "./lightbox";

interface MediaGalleryProps {
  media: Media[];
  editable?: boolean;
  onDelete?: (id: string) => void;
  getImageUrl: (s3Key: string) => string;
}

export function MediaGallery({
  media,
  editable = false,
  onDelete,
  getImageUrl,
}: MediaGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm("Delete this image?")) return;
      onDelete?.(id);
    },
    [onDelete],
  );

  if (media.length === 0) return null;

  return (
    <>
      <div className="columns-2 gap-3 sm:columns-3 md:columns-4">
        {media.map((item, i) => (
          <div
            key={item.id}
            className="group relative mb-3 cursor-pointer break-inside-avoid overflow-hidden rounded-sm"
            onClick={() => setLightboxIndex(i)}
          >
            <Image
              src={getImageUrl(item.thumbnailS3Key ?? item.s3Key)}
              alt={item.caption ?? item.originalFilename ?? "Gallery image"}
              width={item.width ?? 400}
              height={item.height ?? 400}
              className="w-full transition-transform duration-300 group-hover:scale-[1.02]"
            unoptimized
            />
            {editable && (
              <button
                onClick={(e) => handleDelete(item.id, e)}
                className="absolute right-2 top-2 rounded-sm bg-bg-primary/80 p-1 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Trash2
                  className="h-4 w-4 text-accent-red"
                  strokeWidth={1.5}
                />
              </button>
            )}
            {item.caption && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg-primary/80 to-transparent px-2 pb-2 pt-6 opacity-0 transition-opacity group-hover:opacity-100">
                <p className="text-xs text-fg-secondary">{item.caption}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          images={media.map((m) => ({
            src: getImageUrl(m.s3Key),
            alt: m.caption ?? m.originalFilename ?? "Gallery image",
            caption: m.caption ?? undefined,
          }))}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
