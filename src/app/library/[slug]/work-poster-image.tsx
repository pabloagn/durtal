"use client";

import { useState } from "react";
import { ImageLightbox } from "@/components/shared/image-lightbox";
import { PosterGlow } from "./ambient-crystals";
import type { CrystalColor } from "@/lib/types";

interface WorkPosterImageProps {
  src: string;
  alt: string;
  cropX: number;
  cropY: number;
  cropZoom: number;
  palette?: CrystalColor[];
}

export function WorkPosterImage({
  src,
  alt,
  cropX,
  cropY,
  cropZoom,
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
            style={{
              objectPosition: `${cropX}% ${cropY}%`,
              transform: `scale(${cropZoom / 100})`,
              transformOrigin: `${cropX}% ${cropY}%`,
            }}
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
