"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Shuffle } from "lucide-react";
import { useRouter } from "next/navigation";
import { CollageGrid } from "./collage-grid";
import type { CollageMediaItem } from "./collage-grid";
import { Lightbox } from "@/components/media/lightbox";
import { randomizeLayout } from "@/lib/actions/gallery-layouts";
import type { CollageLayoutData } from "@/lib/utils/collage-layout";
import { SectionHeading } from "@/components/shared/section-heading";
import { mediaUrl } from "@/lib/s3/media-url";
import { FadeImage } from "./fade-image";

interface SerializedMedia {
  id: string;
  s3Key: string;
  thumbnailS3Key: string | null;
  caption: string | null;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
}

interface GallerySectionClientProps {
  entityType: "work" | "author";
  entityId: string;
  initialLayout: CollageLayoutData;
  mediaItems: SerializedMedia[];
  title?: string;
}

export function GallerySectionClient({
  entityType,
  entityId,
  initialLayout,
  mediaItems,
  title = "Gallery",
}: GallerySectionClientProps) {
  const router = useRouter();
  const [layout, setLayout] = useState<CollageLayoutData>(initialLayout);
  const [isPending, startTransition] = useTransition();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Build flat ordered list for lightbox
  const orderedMedia = layout.blocks
    .flatMap((b) => b.cells.map((c) => c.mediaId))
    .map((id) => mediaItems.find((m) => m.id === id))
    .filter((m): m is SerializedMedia => m !== undefined);

  const getImageUrl = mediaUrl;
  // A lone image's shape, when its size is known
  const single = mediaItems.length === 1 ? mediaItems[0] : null;
  const singleRatio = single?.width && single.height ? `${single.width} / ${single.height}` : null;

  function handleRandomize() {
    startTransition(async () => {
      const result = await randomizeLayout(entityType, entityId);
      if (result?.layoutData) {
        setLayout(result.layoutData as unknown as CollageLayoutData);
      }
      router.refresh();
    });
  }

  function handleImageClick(_src: string, _alt: string, index: number) {
    setLightboxIndex(index);
  }

  // ── Infinite scroll sentinel ───────────────────────────────────────────────
  // For large galleries we lazy-load more blocks as the user scrolls.
  const INITIAL_BLOCKS = 4;
  const [visibleBlocks, setVisibleBlocks] = useState(INITIAL_BLOCKS);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visibleBlocks >= layout.blocks.length) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleBlocks((v) => Math.min(v + 2, layout.blocks.length));
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleBlocks, layout.blocks.length]);

  // Reset visible count when layout changes
  useEffect(() => {
    setVisibleBlocks(INITIAL_BLOCKS);
  }, [layout]);

  const visibleLayout: CollageLayoutData = {
    blocks: layout.blocks.slice(0, visibleBlocks),
  };

  return (
    <section className="mb-8">
      <SectionHeading
        title={title}
        count={mediaItems.length > 0 ? mediaItems.length : undefined}
        action={
          mediaItems.length > 1 && (
            <button
              onClick={handleRandomize}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-fg-secondary transition-colors hover:text-fg-primary disabled:opacity-40 pointer-coarse:min-h-11"
              aria-label="Randomize layout"
            >
              <Shuffle
                className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`}
                strokeWidth={1.5}
              />
              Shuffle
            </button>
          )
        }
      />

      {/* Single image: standalone */}
      {mediaItems.length === 1 && (
        <div
          className="cursor-pointer overflow-hidden rounded-sm"
          onClick={() => setLightboxIndex(0)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setLightboxIndex(0);
            }
          }}
        >
          {/* With its size known the frame keeps the image's shape while it
              loads; an image that fails leaves that frame (or a 3:2 one)
              blank, never the browser's broken mark */}
          <div
            className="relative w-full max-w-sm overflow-hidden rounded-sm bg-bg-tertiary"
            style={singleRatio ? { aspectRatio: singleRatio } : undefined}
          >
            <FadeImage
              src={getImageUrl(
                mediaItems[0].thumbnailS3Key ?? mediaItems[0].s3Key,
              )}
              alt={
                mediaItems[0].caption ??
                mediaItems[0].originalFilename ??
                "Gallery image"
              }
              className={`protected-image w-full rounded-sm object-cover transition-[filter] duration-200 hover:brightness-110 ${singleRatio ? "absolute inset-0 h-full" : "block"}`}
              loading="lazy"
              fallback={singleRatio ? null : <span className="block aspect-[3/2] w-full" />}
            />
          </div>
        </div>
      )}

      {/* Multiple images: collage grid */}
      {mediaItems.length > 1 && (
        <>
          <div
            className={`transition-opacity duration-200 ${isPending ? "opacity-60" : "opacity-100"}`}
          >
            <CollageGrid
              layout={visibleLayout}
              mediaItems={mediaItems as CollageMediaItem[]}
              onImageClick={handleImageClick}
              getImageUrl={getImageUrl}
            />
          </div>

          {/* Infinite scroll sentinel */}
          {visibleBlocks < layout.blocks.length && (
            <div ref={sentinelRef} className="h-4" aria-hidden="true" />
          )}
        </>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          images={orderedMedia.map((m) => ({
            src: getImageUrl(m.s3Key),
            alt: m.caption ?? m.originalFilename ?? "Gallery image",
            caption: m.caption ?? undefined,
          }))}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </section>
  );
}
