"use client";

import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { AuthorCardActionsMenu } from "./author-card-actions-menu";

interface PosterCrop {
  x: number;
  y: number;
  zoom: number;
}

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
  worksCount,
  isSelecting = false,
  isSelected = false,
  onSelect,
}: AuthorCardProps) {
  const years = birthYear
    ? `${birthYear}–${deathYear ?? ""}`
    : null;

  const hasCrop = posterCrop && (posterCrop.x !== 50 || posterCrop.y !== 50 || posterCrop.zoom !== 100);

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
      {/* Photo — navigates on click */}
      <Link
        href={href}
        className={`block ${isSelecting ? "pointer-events-none" : ""}`}
        tabIndex={isSelecting ? -1 : undefined}
      >
        <div className="shadow-[0_2px_16px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]">
          <div
            className="relative aspect-[2/3] overflow-hidden bg-bg-primary"
            onContextMenu={(e) => e.preventDefault()}
          >
            {photoUrl ? (
              <Image
                src={photoUrl}
                alt={name}
                fill
                sizes="(min-width: 1280px) 200px, (min-width: 768px) 180px, 160px"
                className="protected-image object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                style={
                  hasCrop
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
                <span className="font-serif text-3xl text-fg-muted/30">
                  {name[0]}
                </span>
              </div>
            )}

            {/* Works count overlay — top-right */}
            {worksCount > 0 && !isSelecting && (
              <div className="absolute right-2 top-2">
                <Badge variant="muted">
                  {worksCount} {worksCount === 1 ? "work" : "works"}
                </Badge>
              </div>
            )}

            {/* Three-dot actions menu — bottom-right, visible on hover */}
            {!isSelecting && (
              <div
                className="absolute bottom-1 right-1 z-10 opacity-0 transition-opacity group-hover:opacity-100 @[180px]:bottom-2 @[180px]:right-2"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              >
                <AuthorCardActionsMenu authorId={id} slug={slug} name={name} firstName={firstName} lastName={lastName} />
              </div>
            )}
          </div>
        </div>
      </Link>

      {/* Selection checkbox — top-left, visible in selection mode */}
      {isSelecting && (
        <div className="absolute left-1 top-1 z-10 @[180px]:left-2 @[180px]:top-2">
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

      {/* Meta — navigates on click */}
      <Link
        href={href}
        className={`block ${isSelecting ? "pointer-events-none" : ""}`}
        tabIndex={isSelecting ? -1 : undefined}
      >
        <div className="p-3.5">
          <h3 className="line-clamp-2 font-serif text-lg leading-snug text-fg-primary">
            {name}
          </h3>
          {nationality && (
            <p className="mt-1 line-clamp-1 text-sm text-fg-secondary">
              {nationality}
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            {years && (
              <span className="font-mono text-micro text-fg-muted">{years}</span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
