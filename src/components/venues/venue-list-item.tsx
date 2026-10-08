"use client";

import { VENUE_TYPE_LABELS } from "@/lib/catalogue/venues";
import { CapAligned } from "@/components/shared/cap-aligned";
import Link from "next/link";
import { Star, MapPin, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import type { VenueType } from "@/lib/catalogue/venues";


export interface VenueListItemProps {
  id: string;
  slug: string;
  name: string;
  type: VenueType;
  formattedAddress?: string | null;
  placeName?: string | null;
  isFavorite: boolean;
  personalRating?: number | null;
  website?: string | null;
  thumbnailUrl?: string | null;
  /** Archived venues show only when the list asks for them */
  archived?: boolean;
}

export function VenueListItem({
  id,
  slug,
  name,
  type,
  formattedAddress,
  placeName,
  isFavorite,
  personalRating,
  website,
  thumbnailUrl,
  archived = false,
}: VenueListItemProps) {
  const location = formattedAddress ?? placeName ?? null;

  return (
    <div className="group relative flex items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary">
      <Link
        href={`/places/${slug}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {/* Small thumbnail */}
        <div className="relative h-10 w-14 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="font-serif text-xs text-fg-muted/40">
                {name[0]}
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="type-item-title flex items-start gap-2">
            <h3 className="type-item-title truncate group-hover:text-accent-primary">
              {name}
            </h3>
          </div>
          {location && (
            <p className="flex items-start gap-1 truncate text-xs text-fg-secondary">
              <CapAligned height={10}><MapPin className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} /></CapAligned>
              {location}
            </p>
          )}
        </div>

        {/* Meta */}
        <div className="flex flex-shrink-0 items-center gap-3">
          <Badge variant="muted">{VENUE_TYPE_LABELS[type]}</Badge>
          {archived && <Badge variant="muted">Archived</Badge>}

          {personalRating != null && personalRating > 0 && (
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-2.5 w-2.5 ${
                    i < personalRating
                      ? "fill-accent-gold text-accent-gold"
                      : "fill-transparent text-fg-muted/20"
                  }`}
                  strokeWidth={1.5}
                />
              ))}
            </div>
          )}        </div>
      </Link>
      <FavouriteToggle
        favourite={isFavorite}
        target={{ entity: "venue", id }}
        name={name}
      />
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg-muted transition-colors hover:text-accent-primary"
              aria-label={`Visit ${name} website`}
            >
              <CapAligned height={14} className="font-serif text-xs"><ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} /></CapAligned>
            </a>
          )}
    </div>
  );
}
