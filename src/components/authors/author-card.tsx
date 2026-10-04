"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { AuthorCardActionsMenu } from "./author-card-actions-menu";
import { coverToneStyle, mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";
import { FadeImage } from "@/components/shared/fade-image";
import { CoverFan, Monogram } from "@/components/shared/no-photo";
import { displayYear } from "@/lib/utils/years";

type PosterCrop = MediaCrop;

interface AuthorCardProps {
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
  /** The portrait's main color: the frame shows it while the photo loads */
  photoTone?: string | null;
  /** Book covers to show when there is no portrait */
  coverPreviews?: string[];
  worksCount: number;
  isSelecting?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}

export function AuthorCard({
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
  photoTone,
  coverPreviews = [],
  worksCount,
  isSelecting = false,
  isSelected = false,
  onSelect,
}: AuthorCardProps) {
  const years = birthYear
    ? `${displayYear(birthYear)}–${deathYear ? displayYear(deathYear) : ""}`
    : null;


  const href = `/authors/${slug}`;

  function handleCardClick(e: React.MouseEvent) {
    if (isSelecting && onSelect) {
      e.preventDefault();
      onSelect(id);
    }
  }

  const selectionRing = isSelected ? "ring-2 ring-accent-rose/50" : "";

  return (
    <div
      className={`@container group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive ${selectionRing}`}
      onClick={handleCardClick}
    >
      {/* Photo area — relative wrapper so dropdown escapes overflow-hidden */}
      <div className="relative">
        <Link
          href={href}
          className={`block ${isSelecting ? "pointer-events-none" : ""}`}
          tabIndex={isSelecting ? -1 : undefined}
        >
          <div className="shadow-[0_2px_16px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]">
            {/* While the photo loads, the frame shows its main color */}
            <div
              className="relative aspect-[2/3] overflow-hidden bg-bg-tertiary"
              style={coverToneStyle(photoTone)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {photoUrl ? (
                <FadeImage
                  src={photoUrl}
                  alt={name}
                  loading="lazy"
                  decoding="async"
                  className="protected-image absolute inset-0 h-full w-full object-cover group-hover:scale-[1.02]"
                  style={mediaImageStyle(posterCrop)}
                />
              ) : coverPreviews.length ? (
                <CoverFan covers={coverPreviews} />
              ) : (
                <Monogram name={name} />
              )}

              {/* Works count overlay — top-right */}
              {worksCount > 0 && !isSelecting && (
                <div className="absolute right-2 top-2">
                  <Badge variant="muted">
                    {worksCount} {worksCount === 1 ? "book" : "books"}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </Link>

        {/* Three-dot menu — outside overflow-hidden, opens upward into poster */}
        {!isSelecting && (
          <div
            className="absolute bottom-1 right-1 z-20 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 @[180px]:bottom-2 @[180px]:right-2"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <AuthorCardActionsMenu authorId={id} slug={slug} name={name} firstName={firstName} lastName={lastName} />
          </div>
        )}
      </div>

      {/* Selection checkbox — top-left, visible in selection mode */}
      {isSelecting && (
        <div className="absolute left-1 top-1 z-10 @[180px]:left-2 @[180px]:top-2">
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

      {/* Meta — navigates on click */}
      <Link
        href={href}
        className={`block ${isSelecting ? "pointer-events-none" : ""}`}
        tabIndex={isSelecting ? -1 : undefined}
      >
        <div className="p-3.5">
          {/* Fixed lines: every author card has the same height */}
          <h3 className="type-item-title lines-2">
            {name}
          </h3>
          <p className="mt-1 lines-1 text-sm text-fg-secondary">
            {nationality}
          </p>
          <div className="mt-2.5 flex h-5 items-center gap-2">
            {years && (
              <span className="font-mono text-micro text-fg-secondary">{years}</span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
