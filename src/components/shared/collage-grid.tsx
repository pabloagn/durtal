"use client";

import type { CollageLayoutData, CollageCell } from "@/lib/utils/collage-layout";

export interface CollageMediaItem {
  id: string;
  s3Key: string;
  thumbnailS3Key?: string | null;
  caption?: string | null;
  originalFilename?: string | null;
  width?: number | null;
  height?: number | null;
  sortOrder?: number;
}

interface CollageGridProps {
  layout: CollageLayoutData;
  mediaItems: CollageMediaItem[];
  onImageClick?: (src: string, alt: string, index: number) => void;
  getImageUrl: (s3Key: string) => string;
}

function CellImage({
  cell,
  media,
  getImageUrl,
  onClick,
}: {
  cell: CollageCell;
  media: CollageMediaItem;
  getImageUrl: (s3Key: string) => string;
  onClick: () => void;
}) {
  const src = getImageUrl(media.thumbnailS3Key ?? media.s3Key);
  const alt = media.caption ?? media.originalFilename ?? "Gallery image";

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-sm"
      style={{
        gridRow: `${cell.row + 1} / span ${cell.rowSpan}`,
        gridColumn: `${cell.col + 1} / span ${cell.colSpan}`,
      }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={alt}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
        loading="lazy"
      />
      {media.caption && (
        <div className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6 transition-transform duration-200 group-hover:translate-y-0">
          <p className="text-xs text-fg-secondary">{media.caption}</p>
        </div>
      )}
    </div>
  );
}

export function CollageGrid({
  layout,
  mediaItems,
  onImageClick,
  getImageUrl,
}: CollageGridProps) {
  // Build a lookup map from mediaId → CollageMediaItem
  const mediaMap = new Map<string, CollageMediaItem>(mediaItems.map((m) => [m.id, m]));

  // Build a flat list of (cell, mediaItem, globalIndex) for lightbox indexing
  const flatCells: Array<{ cell: CollageCell; item: CollageMediaItem; idx: number }> = [];
  let globalIdx = 0;
  for (const block of layout.blocks) {
    for (const cell of block.cells) {
      const item = mediaMap.get(cell.mediaId);
      if (item) {
        flatCells.push({ cell, item, idx: globalIdx++ });
      }
    }
  }

  if (layout.blocks.length === 0) return null;

  return (
    <div className="space-y-[3px]">
      {layout.blocks.map((block, blockIdx) => {
        // Compute aspect ratio for the block: each unit cell is roughly square.
        // We use a CSS aspect-ratio on the grid container.
        // Height of the grid = (block.rows / block.columns) * 100%
        const aspectRatio = `${block.columns} / ${block.rows}`;

        return (
          <div
            key={blockIdx}
            className="w-full"
            style={{ aspectRatio }}
          >
            <div
              className="grid h-full w-full gap-[3px]"
              style={{
                gridTemplateColumns: `repeat(${block.columns}, 1fr)`,
                gridTemplateRows: `repeat(${block.rows}, 1fr)`,
              }}
            >
              {block.cells.map((cell) => {
                const item = mediaMap.get(cell.mediaId);
                if (!item) return null;

                // Find global index for this cell (for lightbox)
                const entry = flatCells.find(
                  (fc) => fc.cell.mediaId === cell.mediaId,
                );
                const idx = entry?.idx ?? 0;

                return (
                  <CellImage
                    key={cell.mediaId}
                    cell={cell}
                    media={item}
                    getImageUrl={getImageUrl}
                    onClick={() => {
                      const fullSrc = getImageUrl(item.s3Key);
                      const alt =
                        item.caption ??
                        item.originalFilename ??
                        "Gallery image";
                      onImageClick?.(fullSrc, alt, idx);
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
