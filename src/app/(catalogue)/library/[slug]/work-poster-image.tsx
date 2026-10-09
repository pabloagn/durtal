"use client";

import { useState } from "react";
import { ImageLightbox } from "@/components/shared/image-lightbox";
import { PosterGlow } from "./ambient-crystals";
import type { CrystalColor } from "@/lib/types";
import { mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";

interface WorkPosterImageProps {
  src: string;
  alt: string;
  crop: MediaCrop;
  palette?: CrystalColor[];
}

export function WorkPosterImage({
  src,
  alt,
  crop,
  palette,
}: WorkPosterImageProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <>
      <div
        className="relative h-64 w-44 flex-shrink-0 overflow-visible"
      >
        {/* Color glow behind the poster */}
        {palette && palette.length > 0 && (
          <PosterGlow palette={palette} />
        )}

        <div
          className="relative h-full w-full overflow-hidden rounded-sm bg-bg-tertiary cursor-pointer"
          onClick={() => setLightboxOpen(true)}
          role="button"
          aria-label={`View full image: ${alt}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setLightboxOpen(true);
            }
          }}
        >
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
            style={mediaImageStyle(crop)}
          />
        </div>
      </div>

      <ImageLightbox
        src={src}
        alt={alt}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}
