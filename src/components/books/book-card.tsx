"use client";

import { CopyBookButton } from "./copy-book-button";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";

import { useState } from "react";
import Link from "next/link";
import { HuntBadge } from "./hunt-badge";
import { PoisonBadge } from "./poison-badge";
import { COVER_CORNER } from "./cover-chip";
import type { CardReadingValue } from "@/lib/reading/card";
import { CardHeading } from "@/components/shared/card-heading";
import { WORK_CARD, WORK_CARD_BODY, WorkCardInfo } from "@/components/shared/work-card";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { BookCardActionsMenu } from "./book-card-actions-menu";
import { EbookMark } from "./ebook-mark";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";
import { coverToneStyle, mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";
import { FadeImage } from "@/components/shared/fade-image";
import { MEDIA_WIDTHS, withMediaWidth } from "@/lib/s3/media-url";
import { useCoverMenu } from "@/hooks/use-cover-menu";

export type CoverCrop = MediaCrop;

interface BookCardProps {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  authorNames?: string[];
  /** The particular edition responsible for a translator/publisher association. */
  editionNote?: string;
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
  /** The favourite star shows when this is given */
  isFavourite?: boolean;
  acquisitionPriority?: string | null;
  primaryEditionId?: string | null;
  /**
   * The work's readable e-book, or null: the cover's eBook mark and Read.
   * Required, so no page that draws book cards can leave the mark out (SLN-505).
   */
  ebook: WorkEbookDTO | null;
  readerReturnTo?: string;
  /** When true, show a checkbox overlay instead of navigation on click */
  isSelecting?: boolean;
  isSelected?: boolean;
  onSelect?: (workId: string) => void;
  /** `sizes` for the cover: the card's rendered width */
  coverSizes?: string;
  /** Load the cover at once with high priority (cards above the fold) */
  coverPriority?: boolean;
  /** An open reading: it takes the status slot ("Reading 44%") */
  reading?: CardReadingValue;
}

export function CoverPlaceholder({ title }: { title: string }) {
  return (
    <div className={`h-full ${COVER_BLANK}`}>
      <CoverLetter title={title} />
    </div>
  );
}

function CoverImage({
  src,
  alt,
  crop,
  sizes,
  priority = false,
}: {
  src: string;
  alt: string;
  crop?: CoverCrop | null;
  sizes: string;
  priority?: boolean;
}) {
  const [retries, setRetries] = useState(0);
  const maxRetries = 3;

  if (retries >= maxRetries) {
    return (
      <>
        <CoverPlaceholder title={alt} />
        <span className="sr-only">{alt}</span>
      </>
    );
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
      className="protected-image cover-image"
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
  editionNote,
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
  isFavourite,
  primaryEditionId,
  ebook,
  readerReturnTo,
  isSelecting = false,
  isSelected = false,
  onSelect,
  coverSizes = "(min-width: 1280px) 300px, (min-width: 768px) 250px, 200px",
  coverPriority = false,
  reading,
}: BookCardProps) {
  const href = `/library/${slug}`;
  const [menuOpen, setMenuOpen] = useState(false);
  // Reset before rendering selection so the menu stays closed when it ends.
  if (isSelecting && menuOpen) setMenuOpen(false);
  const coverMenu = useCoverMenu(!isSelecting, () => setMenuOpen(true));
  const digitalMark = ebook?.readable;

  // In selection mode, clicking the card toggles selection instead of navigating
  function handleCardClick(e: React.MouseEvent) {
    if (isSelecting && onSelect) {
      e.preventDefault();
      onSelect(workId);
    }
  }

  const selectionRing = isSelected ? "ring-2 ring-accent-primary/50" : "";

  return (
    <div
      className={`${WORK_CARD} ${selectionRing}`}
      onClick={handleCardClick}
    >
      {/* Cover area — relative wrapper so the dropdown menu escapes overflow-hidden */}
      <div className="relative">
        {/* Named by what it holds: the cover's alt, or on a blank cover the
            title as hidden text (its letter is decoration, and a title with
            no letter or digit, "!!!", shows none), then the cover's marks
            ("Rare", "eBook available"), which a label would hide */}
        <Link
          href={href}
          className={`block ${isSelecting ? "pointer-events-none" : ""}`}
          tabIndex={isSelecting ? -1 : undefined}
          {...coverMenu}
        >
          <div className="cover-shadow">
          {/* While the cover loads, the frame shows the poster's main color */}
          <div
            className="relative aspect-[2/3] overflow-hidden bg-bg-tertiary"
            style={coverToneStyle(coverTone)}
          >
            {coverUrl ? (
              <CoverImage
                src={coverUrl}
                alt={title}
                crop={coverCrop}
                sizes={coverSizes}
                priority={coverPriority}
              />
            ) : (
              <>
                <CoverPlaceholder title={title} />
                <span className="sr-only">{title}</span>
              </>
            )}

            {/* The cover shows its art: only the marks that make a copy
                special sit on it, in one corner. Status and rating are in
                the info row below. */}
            {(isRare || isPoison || digitalMark) && (
              <div className={COVER_CORNER.bottomLeft}>
                <HuntBadge isRare={isRare} huntAssessedOn={huntAssessedOn} cover />
                <PoisonBadge isPoison={isPoison} cover />
                <EbookMark ebook={ebook ?? null} />
              </div>
            )}
          </div>
          </div>
        </Link>

        {!isSelecting && (
          <div className={`artwork-actions ${menuOpen ? "before:!opacity-100 [&>button]:!opacity-100 [&>div]:!opacity-100" : ""}`} onClick={(e) => { e.stopPropagation(); }}>
            <CopyBookButton title={title} authorNames={authorNames} authorName={authorName} glass />
            <BookCardActionsMenu workId={workId} slug={slug} title={title} authorName={authorName} primaryEditionId={primaryEditionId ?? undefined} ebook={ebook ?? null} readerReturnTo={readerReturnTo ?? href} open={menuOpen} onOpenChange={setMenuOpen} />
          </div>
        )}
      </div>

      {/* Selection checkbox -- top-left, visible in selection mode */}
      {isSelecting && (
        <div className="absolute left-1 top-1 z-10 @[220px]:left-2 @[220px]:top-2">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded-sm border transition-colors ${
              isSelected
                ? "border-accent-primary bg-selection-bg text-fg-primary"
                : "glass-chip text-transparent"
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

      {/* Meta — navigates when not selecting. The link covers the text, so
          the favourite star can sit above it */}
      <div className="relative flex flex-1 flex-col">
        <Link
          href={href}
          aria-label={title}
          className={`absolute inset-0 z-10 ${isSelecting ? "pointer-events-none" : ""}`}
          tabIndex={-1}
        />
        <div className={WORK_CARD_BODY}>
          {/* Names wrap naturally; row stretching aligns the footer */}
          <CardHeading
            title={title}
            subtitle={authorName}
            action={
              isFavourite === undefined ? undefined : (
                <FavouriteToggle
                  favourite={isFavourite}
                  target={{ entity: "work", id: workId }}
                  name={title}
                />
              )
            }
          />
          {editionNote && (
            <p className="mt-2 text-xs text-fg-secondary [overflow-wrap:anywhere]">
              {editionNote}
            </p>
          )}
          <WorkCardInfo
            status={catalogueStatus}
            priority={acquisitionPriority}
            copies={instanceCount}
            reading={reading}
            language={language}
            rating={rating}
            year={publicationYear}
          />
        </div>
      </div>
    </div>
  );
}
