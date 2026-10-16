"use client";

import { useState } from "react";
import {
  CoarseImageSource,
  coarseImageFallback,
} from "@/components/shared/coarse-image-source";
import { ImageLightbox } from "@/components/shared/image-lightbox";
import { PosterGlow } from "./ambient-crystals";
import type { CrystalColor } from "@/lib/types";
import { mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";
import { CoverPlaceholder } from "@/components/books/book-card";
import { WORK_POSTER_BOX } from "./work-poster-box";
import { FadeImage } from "@/components/shared/fade-image";

interface WorkPosterImageProps {
  src: string;
  alt: string;
  /** For the placeholder's letter if the image fails */
  title: string;
  crop: MediaCrop;
  palette?: CrystalColor[];
}

export function WorkPosterImage({
  src,
  alt,
  title,
  crop,
  palette,
}: WorkPosterImageProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  // An image that fails leaves the cover's place to the title's letter, as with none
  if (failed) return <WorkPosterPlaceholder title={title} />;

  return (
    <>
      <div className={`${WORK_POSTER_BOX} overflow-visible`}>
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
          <picture className="block h-full w-full">
            <CoarseImageSource src={src} />
            <source media="(pointer: fine)" srcSet={src} />
            <FadeImage
              src={coarseImageFallback(src)}
              alt={alt}
              className="h-full w-full object-cover hover:scale-[1.03]"
              style={mediaImageStyle(crop)}
              onError={() => setFailed(true)}
            />
          </picture>
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

/** A book with no poster and no edition cover keeps its cover's place */
export function WorkPosterPlaceholder({ title }: { title: string }) {
  return (
    <div className={`${WORK_POSTER_BOX} overflow-hidden rounded-sm bg-bg-tertiary`}>
      <CoverPlaceholder title={title} />
    </div>
  );
}
