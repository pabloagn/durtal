"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/constants/catalogue";
import { BookCardActionsMenu } from "./book-card-actions-menu";
import type { CatalogueStatus, AcquisitionPriority } from "@/lib/types";

export interface CoverCrop {
  x: number;
  y: number;
  zoom: number;
}

interface BookCardProps {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  coverCrop?: CoverCrop | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
  acquisitionPriority?: string | null;
  primaryEditionId?: string | null;
  /** When true, show a checkbox overlay instead of navigation on click */
  isSelecting?: boolean;
  isSelected?: boolean;
  onSelect?: (workId: string) => void;
}

function CoverPlaceholder({ letter }: { letter: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="font-serif text-3xl text-fg-muted/30">{letter}</span>
    </div>
  );
}

function CoverImage({
  src,
  alt,
  fallbackLetter,
  crop,
}: {
  src: string;
  alt: string;
  fallbackLetter: string;
  crop?: CoverCrop | null;
}) {
  const [retries, setRetries] = useState(0);
  const maxRetries = 3;

  if (retries >= maxRetries) {
    return <CoverPlaceholder letter={fallbackLetter} />;
  }

  const hasCrop = crop && (crop.x !== 50 || crop.y !== 50 || crop.zoom !== 100);
  // Append retry count to bust the browser's failed-request cache
  const retrySrc = retries > 0 ? `${src}&_r=${retries}` : src;

  return (
    <Image
      key={retries}
      src={retrySrc}
      alt={alt}
      fill
      sizes="(min-width: 1280px) 300px, (min-width: 768px) 250px, 200px"
      className="protected-image object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      style={
        hasCrop
          ? {
              objectPosition: `${crop.x}% ${crop.y}%`,
              transform: `scale(${crop.zoom / 100})`,
              transformOrigin: `${crop.x}% ${crop.y}%`,
            }
          : undefined
      }
      onError={() => {
        // Retry after a short delay — the server was likely just overloaded
        setTimeout(() => setRetries((r) => r + 1), 500 * (retries + 1));
      }}
      unoptimized
    />
  );
}

export function BookCard({
  workId,
  slug,
  title,
  authorName,
  coverUrl,
  coverCrop,
  publicationYear,
  language,
  instanceCount,
  rating,
  catalogueStatus,
  acquisitionPriority,
  primaryEditionId,
  isSelecting = false,
  isSelected = false,
  onSelect,
}: BookCardProps) {
  const statusInfo = catalogueStatus
    ? STATUS_CONFIG[catalogueStatus as CatalogueStatus]
    : null;

  const href = `/library/${slug}`;

  // In selection mode, clicking the card toggles selection instead of navigating
  function handleCardClick(e: React.MouseEvent) {
    if (isSelecting && onSelect) {
      e.preventDefault();
      onSelect(workId);
    }
  }

  const selectionRing = isSelected ? "ring-2 ring-accent-rose/50" : "";

  return (
    <div
      className={`@container group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive ${selectionRing}`}
      onClick={handleCardClick}
    >
      {/* Cover — navigates when not selecting */}
      <Link
        href={href}
        className={`block ${isSelecting ? "pointer-events-none" : ""}`}
        tabIndex={isSelecting ? -1 : undefined}
      >
        <div className="shadow-[0_2px_16px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]">
        <div className="relative aspect-[2/3] overflow-hidden bg-bg-primary" onContextMenu={(e) => e.preventDefault()}>
          {coverUrl ? (
            <CoverImage
              src={coverUrl}
              alt={title}
              fallbackLetter={title[0]}
              crop={coverCrop}
            />
          ) : (
            <CoverPlaceholder letter={title[0]} />
          )}

          {/* Status badge -- top-left */}
          {statusInfo && (
            <div className="absolute left-1 top-1 @[220px]:left-2 @[220px]:top-2">
              <Badge
                variant={statusInfo.variant}
                className="backdrop-blur-md border-white/15"
              >
                <span className="hidden @[220px]:inline">{statusInfo.label}</span>
                <span className="@[220px]:hidden">{statusInfo.shortLabel}</span>
              </Badge>
            </div>
          )}

          {/* Rating overlay */}
          {rating && (
            <div className="absolute right-1 top-1 @[220px]:right-2 @[220px]:top-2">
              <Badge variant="gold" className="backdrop-blur-md border-white/15">
                <span className="hidden @[220px]:inline">{rating}/5</span>
                <span className="@[220px]:hidden">{rating}</span>
              </Badge>
            </div>
          )}

          {/* Priority indicator dot */}
          {acquisitionPriority && acquisitionPriority !== "none" && (() => {
            const pConfig = PRIORITY_CONFIG[acquisitionPriority as AcquisitionPriority];
            return (
              <div
                className="absolute bottom-1 left-1 flex items-center justify-center rounded-[2px] border border-white/15 bg-black/50 backdrop-blur-md @[220px]:bottom-2 @[220px]:left-2 h-4 w-4 @[220px]:h-5 @[220px]:w-5"
                title={`${pConfig?.label ?? acquisitionPriority} priority`}
              >
                <span
                  className={`block h-1.5 w-1.5 rounded-full @[220px]:h-2 @[220px]:w-2 ${pConfig?.dotColor ?? "bg-fg-muted"} ${pConfig?.glowColor ?? ""}`}
                />
              </div>
            );
          })()}

          {/* Three-dot actions menu -- bottom-right of cover, visible on hover */}
          {!isSelecting && (
            <div
              className="absolute bottom-1 right-1 z-10 opacity-0 transition-opacity group-hover:opacity-100 @[220px]:bottom-2 @[220px]:right-2"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            >
              <BookCardActionsMenu workId={workId} slug={slug} title={title} authorName={authorName} primaryEditionId={primaryEditionId ?? undefined} />
            </div>
          )}
        </div>
        </div>
      </Link>

      {/* Selection checkbox -- top-left, visible in selection mode */}
      {isSelecting && (
        <div className="absolute left-1 top-1 z-10 @[220px]:left-2 @[220px]:top-2">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded-sm border transition-colors ${
              isSelected
                ? "border-accent-rose bg-accent-rose text-white"
                : "border-glass-border bg-black/60 text-transparent backdrop-blur-sm"
            }`}
          >
            {isSelected && (
              <svg
                className="h-3 w-3"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 6l3 3 5-5" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Meta — navigates when not selecting */}
      <Link
        href={href}
        className={`block ${isSelecting ? "pointer-events-none" : ""}`}
        tabIndex={isSelecting ? -1 : undefined}
      >
        <div className="p-3.5">
          <h3 className="line-clamp-2 font-serif text-lg leading-snug text-fg-primary">
            {title}
          </h3>
          <p className="mt-1 line-clamp-1 text-sm text-fg-secondary">
            {authorName}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            {publicationYear && (
              <span className="font-mono text-micro text-fg-muted">
                {publicationYear}
              </span>
            )}
            {language && language !== "en" && (
              <Badge variant="blue">{language}</Badge>
            )}
            <span className="ml-auto font-mono text-micro text-fg-muted">
              {instanceCount} {instanceCount === 1 ? "copy" : "copies"}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
