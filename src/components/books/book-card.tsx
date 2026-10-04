"use client";

import { CopyBookButton } from "./copy-book-button";

import { useState } from "react";
import Link from "next/link";
import { HuntBadge } from "./hunt-badge";
import { PoisonBadge } from "./poison-badge";
import { COVER_CORNER } from "./cover-chip";
import { CardRating, CardStatus } from "./card-status";
import { Badge } from "@/components/ui/badge";
import { CardHeading } from "@/components/shared/card-heading";
import { BookCardActionsMenu } from "./book-card-actions-menu";
import { DigitalEditionBadge } from "@/components/reader/digital-edition-badge";
import { coverToneStyle, mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";
import { FadeImage } from "@/components/shared/fade-image";
import { MEDIA_WIDTHS, withMediaWidth } from "@/lib/s3/media-url";

export type CoverCrop = MediaCrop;

interface BookCardProps {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  authorNames?: string[];
  coverUrl?: string | null;
  coverCrop?: CoverCrop | null;
  /** The poster's main color: the frame shows it while the cover loads */
  coverTone?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
  isRare?: boolean;
  huntAssessedOn?: string | null;
  isPoison?: boolean;
  acquisitionPriority?: string | null;
  primaryEditionId?: string | null;
  /** Whether a digital edition exists in Calibre for this work */
  hasDigitalEdition?: boolean;
  /** When true, show a checkbox overlay instead of navigation on click */
  isSelecting?: boolean;
  isSelected?: boolean;
  onSelect?: (workId: string) => void;
  /** `sizes` for the cover: the card's rendered width */
  coverSizes?: string;
  /** Load the cover at once with high priority (cards above the fold) */
  coverPriority?: boolean;
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
  sizes,
  priority = false,
}: {
  src: string;
  alt: string;
  fallbackLetter: string;
  crop?: CoverCrop | null;
  sizes: string;
  priority?: boolean;
}) {
  const [retries, setRetries] = useState(0);
  const maxRetries = 3;

  if (retries >= maxRetries) {
    return <CoverPlaceholder letter={fallbackLetter} />;
  }

  // Append retry count to bust the browser's failed-request cache
  const retrySrc = retries > 0 ? `${src}&_r=${retries}` : src;
  // The route resizes each candidate; the browser picks one for `sizes`
  const srcSet = MEDIA_WIDTHS.map((w) => `${withMediaWidth(retrySrc, w)} ${w}w`).join(", ");

  return (
    <FadeImage
      key={retries}
      src={withMediaWidth(retrySrc, 400)}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className="protected-image absolute inset-0 h-full w-full object-cover group-hover:scale-[1.02]"
      style={mediaImageStyle(crop)}
      onError={() => {
        // Retry after a short delay — the server was likely just overloaded
        setTimeout(() => setRetries((r) => r + 1), 500 * (retries + 1));
      }}
    />
  );
}

export function BookCard({
  workId,
  slug,
  title,
  authorName,
  authorNames,
  coverUrl,
  coverCrop,
  coverTone,
  publicationYear,
  language,
  instanceCount,
  rating,
  catalogueStatus,
  acquisitionPriority,
  isRare,
  huntAssessedOn,
  isPoison,
  primaryEditionId,
  hasDigitalEdition = false,
  isSelecting = false,
  isSelected = false,
  onSelect,
  coverSizes = "(min-width: 1280px) 300px, (min-width: 768px) 250px, 200px",
  coverPriority = false,
}: BookCardProps) {
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
      {/* Cover area — relative wrapper so the dropdown menu escapes overflow-hidden */}
      <div className="relative">
        <Link
          href={href}
          className={`block ${isSelecting ? "pointer-events-none" : ""}`}
          tabIndex={isSelecting ? -1 : undefined}
        >
          <div className="shadow-[0_2px_16px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]">
          {/* While the cover loads, the frame shows the poster's main color */}
          <div
            className="relative aspect-[2/3] overflow-hidden bg-bg-tertiary"
            style={coverToneStyle(coverTone)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {coverUrl ? (
              <CoverImage
                src={coverUrl}
                alt={title}
                fallbackLetter={title[0]}
                crop={coverCrop}
                sizes={coverSizes}
                priority={coverPriority}
              />
            ) : (
              <CoverPlaceholder letter={title[0]} />
            )}

            {/* The cover shows its art: only the marks that make a copy
                special sit on it, in one corner. Status and rating are in
                the info row below. */}
            {(isRare || isPoison || hasDigitalEdition) && (
              <div className={COVER_CORNER.bottomLeft}>
                <HuntBadge isRare={isRare} huntAssessedOn={huntAssessedOn} cover />
                <PoisonBadge isPoison={isPoison} cover />
                {hasDigitalEdition && <DigitalEditionBadge />}
              </div>
            )}
          </div>
          </div>
        </Link>

        {/* Copy button — hidden until hover, like the three-dot menu; stays visible with keyboard focus */}
        {!isSelecting && <div className="absolute bottom-1 right-8 z-20 hover-reveal @[220px]:bottom-2 @[220px]:right-10">
          <CopyBookButton title={title} authorNames={authorNames} authorName={authorName} className="border border-white/10 bg-overlay" />
        </div>}

        {/* Three-dot menu — lives outside overflow-hidden, opens upward into poster */}
        {!isSelecting && (
          <div
            className="absolute bottom-1 right-1 z-20 hover-reveal @[220px]:bottom-2 @[220px]:right-2"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <BookCardActionsMenu workId={workId} slug={slug} title={title} authorName={authorName} primaryEditionId={primaryEditionId ?? undefined} />
          </div>
        )}
      </div>

      {/* Selection checkbox -- top-left, visible in selection mode */}
      {isSelecting && (
        <div className="absolute left-1 top-1 z-10 @[220px]:left-2 @[220px]:top-2">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded-sm border transition-colors ${
              isSelected
                ? "border-accent-rose bg-accent-rose text-fg-primary"
                : "border-glass-border bg-overlay text-transparent"
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
          {/* Two title lines and one author line, always: every book card
              has the same height, and the author sits under the title */}
          <CardHeading title={title} subtitle={authorName} />
          <div className="mt-2.5 flex h-5 items-center gap-2">
            <CardStatus
              status={catalogueStatus}
              priority={acquisitionPriority}
              copies={instanceCount}
            />
            {/* The status keeps the row: the rating shows from 160px of card
                width, the language from 200px, the year from 160px (220px
                beside a rating) */}
            {language && language !== "en" && (
              <span className="hidden @[200px]:contents">
                <Badge variant="blue">{language}</Badge>
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <span className="hidden @[160px]:contents">
                <CardRating rating={rating} />
              </span>
              {publicationYear && (
                <span
                  className={`hidden font-mono text-micro text-fg-secondary ${rating ? "@[220px]:inline" : "@[160px]:inline"}`}
                >
                  {publicationYear}
                </span>
              )}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
