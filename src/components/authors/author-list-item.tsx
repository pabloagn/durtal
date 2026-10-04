"use client";

import Image from "next/image";
import Link from "next/link";
import { AuthorCardActionsMenu } from "./author-card-actions-menu";
import { mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";
import { displayYear } from "@/lib/utils/years";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { RowCheckbox } from "@/components/books/book-list";

type PosterCrop = MediaCrop;

interface AuthorListItemProps {
  id: string;
  slug: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  nationality?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  photoUrl?: string | null;
  posterCrop?: PosterCrop | null;
  worksCount: number;
  isSelecting?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}

export function AuthorListItem({
  id,
  slug,
  name,
  firstName,
  lastName,
  nationality,
  birthYear,
  deathYear,
  photoUrl,
  posterCrop,
  worksCount,
  isSelecting = false,
  isSelected = false,
  onSelect,
}: AuthorListItemProps) {
  const years = birthYear
    ? `${displayYear(birthYear)}–${deathYear ? displayYear(deathYear) : ""}`
    : null;

  function handleRowClick(e: React.MouseEvent) {
    if (isSelecting && onSelect) {
      e.preventDefault();
      onSelect(id);
    }
  }

  const selectionBg = isSelected ? "bg-accent-rose/5" : "";

  return (
    <div
      className={`group relative flex items-start gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary ${selectionBg}`}
      onClick={handleRowClick}
    >
      <Link
        href={`/people/${slug}`}
        className={`flex min-w-0 flex-1 items-center gap-3 ${isSelecting ? "pointer-events-none" : ""}`}
        tabIndex={isSelecting ? -1 : undefined}
      >
        {/* Small thumbnail; in selection mode it carries the checkbox */}
        <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary" onContextMenu={(e) => e.preventDefault()}>
          {photoUrl ? (
            <Image
              src={photoUrl}
              alt={name}
              fill
              sizes="28px"
              className="protected-image object-cover"
              style={mediaImageStyle(posterCrop)}
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="font-serif text-micro text-fg-muted/40">
                {name[0]}
              </span>
            </div>
          )}
          {isSelecting && <RowCheckbox checked={isSelected} />}
        </div>

        {/* Two lines, like a book row: name and years, then nationality and the book count */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <h3 className="type-item-title min-w-0 flex-1 truncate group-hover:text-accent-rose-text">
              {name}
            </h3>
            {years && (
              <span className="font-mono text-micro text-fg-secondary">{years}</span>
            )}
          </div>
          <div className="flex items-baseline gap-3">
            <p className="min-w-0 flex-1 truncate text-sm text-fg-secondary">
              {nationality ?? "Unknown nationality"}
            </p>
            <span className="w-16 whitespace-nowrap text-right font-mono text-micro text-fg-secondary">
              {worksCount} {worksCount === 1 ? "book" : "books"}
            </span>
          </div>
        </div>
      </Link>

      {/* Actions menu, on the name's cap-height center; visible on hover */}
      {!isSelecting && (
        <div
          className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <CapAlignedControls height={28} className="type-item-title">
            <AuthorCardActionsMenu authorId={id} slug={slug} name={name} firstName={firstName} lastName={lastName} />
          </CapAlignedControls>
        </div>
      )}
    </div>
  );
}
