"use client";

import Link from "next/link";
import { Star, MapPin, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { VenueType } from "@/lib/actions/venues";

const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  bookshop: "Bookshop",
  online_store: "Online Store",
  cafe: "Cafe",
  library: "Library",
  museum: "Museum",
  gallery: "Gallery",
  auction_house: "Auction House",
  market: "Market",
  fair: "Fair",
  publisher: "Publisher",
  individual: "Individual",
  other: "Other",
};

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
}

export function VenueListItem({
  slug,
  name,
  type,
  formattedAddress,
  placeName,
  isFavorite,
  personalRating,
  website,
  thumbnailUrl,
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
            // eslint-disable-next-line @next/next/no-img-element
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
          <div className="flex items-center gap-2">
            <h3 className="truncate font-serif text-lg text-fg-primary group-hover:text-accent-rose">
              {name}
            </h3>
            {isFavorite && (
              <Star
                className="h-3 w-3 shrink-0 fill-accent-gold text-accent-gold"
                strokeWidth={1.5}
              />
            )}
          </div>
          {location && (
            <p className="flex items-center gap-1 truncate text-xs text-fg-muted">
              <MapPin className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} />
              {location}
            </p>
          )}
        </div>

        {/* Meta */}
        <div className="flex flex-shrink-0 items-center gap-3">
          <Badge variant="muted">{VENUE_TYPE_LABELS[type]}</Badge>

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
          )}

          {website && (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg-muted transition-colors hover:text-accent-rose"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
            </a>
          )}
        </div>
      </Link>
    </div>
  );
}
