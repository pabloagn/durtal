"use client";

import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { CopyBookButton } from "./copy-book-button";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";
import { CatalogueReadLink } from "@/components/ebooks/catalogue-read-action";

import Image from "next/image";
import Link from "next/link";
import { HuntBadge } from "./hunt-badge";
import { PoisonBadge } from "./poison-badge";
import { Badge } from "@/components/ui/badge";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/constants/catalogue";
import type { CatalogueStatus, AcquisitionPriority } from "@/lib/types";
import type { CoverCrop } from "./book-card";
import { mediaImageStyle } from "@/lib/utils/media-style";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { formatRating } from "@/lib/utils/rating";
import { readingBadge, type CardReadingValue, type ReadingSummaryValue } from "@/lib/reading/card";

interface BookListItem {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  authorNames?: string[];
  coverUrl?: string | null;
  coverCrop?: CoverCrop | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
  isRare?: boolean;
  huntAssessedOn?: string | null;
  isPoison?: boolean;
  isFavourite?: boolean;
  ebook?: WorkEbookDTO | null;
  readerReturnTo?: string;
  acquisitionPriority?: string | null;
  /** An open reading, until the summaries load */
  reading?: CardReadingValue;
  /** Reading state, times read and progress (SLN-449), loaded with the list */
  readingSummary?: ReadingSummaryValue;
}

interface BookListProps {
  books: BookListItem[];
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (workId: string) => void;
}

/** The selection mark on a row's thumbnail, like the grid card's */
export function RowCheckbox({ checked }: { checked: boolean }) {
  return (
    <div
      className={`absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-[2px] border transition-colors ${
        checked
          ? "border-accent-primary bg-selection-bg text-fg-primary"
          : "glass-chip text-transparent"
      }`}
    >
      {checked && (
        <svg
          className="h-2.5 w-2.5"
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
  );
}

/** The reader link's width, kept in rows without one so every row's status and year line up */
function ReadSlot() {
  return (
    <span aria-hidden="true" className="invisible inline-flex min-h-8 items-center gap-1.5 px-2 text-xs pointer-coarse:min-h-11" data-read-slot="">
      <span className="h-3.5 w-3.5" />Read
    </span>
  );
}

/**
 * A list row is two lines beside its thumbnail. The first line holds the
 * title, then the marks, status and rating, then the actions: each on the
 * title's cap-height center. The second line holds the author, the year and
 * the copies, on the author's baseline. Titles and authors wrap in full.
 *
 * In a list narrower than 640px (a phone) the marks, status, year and copies
 * go to a third line under the author, with the actions at its end, so the
 * title and author take the row's whole width.
 */
export function BookList({ books, isSelecting = false, selectedIds, onSelect }: BookListProps) {
  // When any row can be read here, every row keeps the Read link's room
  const readSlot = !isSelecting && books.some((book) => book.ebook?.readable && book.ebook.readerPath);
  return (
    <div className="@container/list space-y-px">
      {books.map((book) => {
        const isSelected = selectedIds?.has(book.workId) ?? false;

        function handleRowClick(e: React.MouseEvent) {
          if (isSelecting && onSelect) {
            e.preventDefault();
            onSelect(book.workId);
          }
        }

        const statusInfo = book.catalogueStatus
          ? STATUS_CONFIG[book.catalogueStatus as CatalogueStatus]
          : null;
        const priorityInfo =
          book.acquisitionPriority && book.acquisitionPriority !== "none"
            ? PRIORITY_CONFIG[book.acquisitionPriority as AcquisitionPriority]
            : null;
        const badge = readingBadge(book.readingSummary, book.reading);
        const readable = !!(book.ebook?.readable && book.ebook.readerPath);

        const marks = (
          <>
            <HuntBadge {...book} />
            <PoisonBadge isPoison={book.isPoison} />
            {priorityInfo && (
              <span
                className={`inline-block h-2 w-2 rounded-full ${priorityInfo.dotColor}`}
                role="img"
                aria-label={`${priorityInfo.label} priority`}
                data-tooltip={`${priorityInfo.label} priority`}
              />
            )}
            {statusInfo && <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>}
            {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
            {book.rating != null && <Badge variant="gold">{formatRating(book.rating)}/5</Badge>}
          </>
        );
        const year = book.publicationYear ? (
          <span className="font-mono text-micro text-fg-secondary">{book.publicationYear}</span>
        ) : null;
        const copies = `${book.instanceCount} ${book.instanceCount === 1 ? "copy" : "copies"}`;

        return (
        <div
          key={book.workId}
          className={`group grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-sm px-3 py-2.5 transition-colors hover:bg-bg-secondary/60 @[40rem]/list:flex @[40rem]/list:items-start ${isSelected ? "bg-accent-primary/5" : ""}`}
          onClick={handleRowClick}
          data-book-row=""
        >
          <Link
            href={`/library/${book.slug}`}
            className={`col-span-2 flex min-w-0 flex-1 items-start gap-3 ${isSelecting ? "pointer-events-none" : ""}`}
            tabIndex={isSelecting ? -1 : undefined}
          >
          {/* Small thumbnail; in selection mode it carries the checkbox. The
              row's Read says it can be read here, so no mark covers it. */}
          <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
            {book.coverUrl ? (
              <Image
                src={book.coverUrl}
                alt={book.title}
                fill
                sizes="28px"
                className="object-cover"
                style={mediaImageStyle(book.coverCrop)}
              unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span aria-hidden="true" data-decorative className="font-serif text-micro text-fg-muted/40">
                  {book.title[0]}
                </span>
              </div>
            )}
            {isSelecting && <RowCheckbox checked={isSelected} />}
          </div>

          <div className="min-w-0 flex-1">
            {/* First line: the title, then (from 640px) the marks, status and rating */}
            <div className="type-item-title flex gap-3">
              <h3 className="type-item-title min-w-0 flex-1 transition-colors [overflow-wrap:anywhere] group-hover:text-accent-primary" data-book-row-title="">
                {book.title}
              </h3>
              <span className="hidden @[40rem]/list:contents">
                <CapAlignedControls height={20}>{marks}</CapAlignedControls>
              </span>
            </div>
            {/* Second line: the author, then (from 640px) the year and the copies */}
            <div className="flex items-baseline gap-3">
              <p className="min-w-0 flex-1 text-sm text-fg-secondary [overflow-wrap:anywhere]">
                {book.authorName}
              </p>
              <span className="hidden @[40rem]/list:contents">
                {year}
                <span className="w-16 whitespace-nowrap text-right font-mono text-micro text-fg-secondary">
                  {copies}
                </span>
              </span>
            </div>
          </div>
          </Link>
          {/* Under 640px: the marks, status, year and copies under the author */}
          <div className="col-start-1 mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-10 @[40rem]/list:hidden" data-book-row-facts="">
            {marks}
            {year}
            <span className="whitespace-nowrap font-mono text-micro text-fg-secondary">{copies}</span>
          </div>
          {/* Beside the title's first line from 640px; at the end of the facts line under it */}
          {(book.isFavourite !== undefined || !isSelecting) && (
            <CapAlignedControls height={32} coarseHeight={44} className="col-start-2 row-start-2 self-center type-item-title @[40rem]/list:self-auto">
              {book.isFavourite !== undefined && (
                <FavouriteToggle
                  favourite={book.isFavourite}
                  target={{ entity: "work", id: book.workId }}
                  name={book.title}
                />
              )}
              {!isSelecting && <CopyBookButton {...book} />}
              {!isSelecting && (readable ? <CatalogueReadLink ebook={book.ebook ?? null} returnTo={book.readerReturnTo} /> : readSlot && <ReadSlot />)}
            </CapAlignedControls>
          )}
        </div>
        );
      })}
    </div>
  );
}
