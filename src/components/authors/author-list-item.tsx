"use client";

import Image from "next/image";
import Link from "next/link";
import { AuthorCardActionsMenu } from "./author-card-actions-menu";

interface PosterCrop {
  x: number;
  y: number;
  zoom: number;
}

interface AuthorListItemProps {
  id: string;
  slug: string;
  name: string;
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
    ? `${birthYear}–${deathYear ?? ""}`
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
      className={`group relative flex items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary ${selectionBg}`}
      onClick={handleRowClick}
    >
      {/* Selection checkbox */}
      {isSelecting && (
        <div className="flex-shrink-0">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded-sm border transition-colors ${
              isSelected
                ? "border-accent-rose bg-accent-rose text-white"
                : "border-glass-border bg-black/60 text-transparent"
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

      <Link
        href={`/authors/${slug}`}
        className={`flex min-w-0 flex-1 items-center gap-3 ${isSelecting ? "pointer-events-none" : ""}`}
        tabIndex={isSelecting ? -1 : undefined}
      >
        {/* Small thumbnail */}
        <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
          {photoUrl ? (
            <Image
              src={photoUrl}
              alt={name}
              fill
              sizes="28px"
              className="object-cover"
              style={
                posterCrop && (posterCrop.x !== 50 || posterCrop.y !== 50 || posterCrop.zoom !== 100)
                  ? {
                      objectPosition: `${posterCrop.x}% ${posterCrop.y}%`,
                      transform: `scale(${posterCrop.zoom / 100})`,
                      transformOrigin: `${posterCrop.x}% ${posterCrop.y}%`,
                    }
                  : undefined
              }
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="font-serif text-nano text-fg-muted/40">
                {name[0]}
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-serif text-lg text-fg-primary group-hover:text-accent-rose">
            {name}
          </h3>
          <p className="truncate text-sm text-fg-secondary">
            {nationality ?? "Unknown nationality"}
          </p>
        </div>

        {/* Meta */}
        <div className="flex flex-shrink-0 items-center gap-3">
          {years && (
            <span className="font-mono text-micro text-fg-muted">{years}</span>
          )}
          <span className="w-14 text-right font-mono text-micro text-fg-muted">
            {worksCount} {worksCount === 1 ? "work" : "works"}
          </span>
        </div>
      </Link>

      {/* Actions menu — visible on hover */}
      {!isSelecting && (
        <div
          className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <AuthorCardActionsMenu authorId={id} slug={slug} name={name} />
        </div>
      )}
    </div>
  );
}
