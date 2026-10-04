"use client";

import { CopyBookButton } from "./copy-book-button";

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
  acquisitionPriority?: string | null;
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
          ? "border-accent-rose bg-accent-rose text-fg-primary"
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

/**
 * A list row is two lines beside its thumbnail. The first line holds the
 * title, then the marks, status and rating, then the copy button: each on
 * the title's cap-height center. The second line holds the author, the year
 * and the copies, on the author's baseline.
 */
export function BookList({ books, isSelecting = false, selectedIds, onSelect }: BookListProps) {
  return (
    <div className="space-y-px">
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

        return (
        <div
          key={book.workId}
          className={`group flex items-start gap-3 rounded-sm px-3 py-2.5 transition-colors hover:bg-bg-secondary/60 ${isSelected ? "bg-accent-rose/5" : ""}`}
          onClick={handleRowClick}
        >
          <Link
            href={`/library/${book.slug}`}
            className={`flex min-w-0 flex-1 items-center gap-3 ${isSelecting ? "pointer-events-none" : ""}`}
            tabIndex={isSelecting ? -1 : undefined}
          >
          {/* Small thumbnail; in selection mode it carries the checkbox */}
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
                <span className="font-serif text-micro text-fg-muted/40">
                  {book.title[0]}
                </span>
              </div>
            )}
            {isSelecting && <RowCheckbox checked={isSelected} />}
          </div>

          <div className="min-w-0 flex-1">
            {/* First line: the title, then the marks, status and rating */}
            <div className="type-item-title flex gap-3">
              <h3 className="type-item-title min-w-0 flex-1 truncate transition-colors group-hover:text-accent-rose-text">
                {book.title}
              </h3>
              <CapAlignedControls height={20}>
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
                {book.rating && <Badge variant="gold">{book.rating}/5</Badge>}
              </CapAlignedControls>
            </div>
            {/* Second line: the author, then the year and the copies */}
            <div className="flex items-baseline gap-3">
              <p className="min-w-0 flex-1 truncate text-sm text-fg-secondary">
                {book.authorName}
              </p>
              {book.publicationYear && (
                <span className="font-mono text-micro text-fg-secondary">
                  {book.publicationYear}
                </span>
              )}
              <span className="w-16 whitespace-nowrap text-right font-mono text-micro text-fg-secondary">
                {book.instanceCount} {book.instanceCount === 1 ? "copy" : "copies"}
              </span>
            </div>
          </div>
          </Link>
          {/* On the title's cap-height center, beside the first line */}
          {!isSelecting && (
            <CapAlignedControls height={28} className="type-item-title">
              <CopyBookButton {...book} />
            </CapAlignedControls>
          )}
        </div>
        );
      })}
    </div>
  );
}
