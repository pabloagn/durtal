"use client";

import Link from "next/link";
import { ExternalLink, Star, MapPin } from "lucide-react";
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

const VENUE_TYPE_BADGE_VARIANTS: Record<
  VenueType,
  "rose" | "gold" | "sage" | "blue" | "muted" | "default"
> = {
  bookshop: "rose",
  online_store: "blue",
  cafe: "gold",
  library: "sage",
  museum: "sage",
  gallery: "gold",
  auction_house: "rose",
  market: "muted",
  fair: "muted",
  publisher: "blue",
  individual: "muted",
  other: "muted",
};

export interface VenueCardProps {
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
  color?: string | null;
}

export function VenueCard({
  slug,
  name,
  type,
  formattedAddress,
  placeName,
  isFavorite,
  personalRating,
  website,
  thumbnailUrl,
  color,
}: VenueCardProps) {
  const href = `/places/${slug}`;
  const location = formattedAddress ?? placeName ?? null;
  const badgeVariant = VENUE_TYPE_BADGE_VARIANTS[type] ?? "muted";

  return (
    <div className="@container group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link href={href} className="block">
        {/* Image / color band */}
        <div className="shadow-[0_2px_16px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]">
          <div
            className="relative aspect-[3/2] overflow-hidden bg-bg-primary"
            style={color ? { backgroundColor: color } : undefined}
          >
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                alt={name}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="font-serif text-3xl text-fg-muted/20">
                  {name[0]}
                </span>
              </div>
            )}

            {/* Favorite star — top-right */}
            {isFavorite && (
              <div className="absolute right-2 top-2">
                <Star
                  className="h-3.5 w-3.5 fill-accent-gold text-accent-gold"
                  strokeWidth={1.5}
                />
              </div>
            )}
          </div>
        </div>
      </Link>

      {/* Meta */}
      <Link href={href} className="block">
        <div className="p-3.5">
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 font-serif text-lg leading-snug text-fg-primary">
              {name}
            </h3>
            <Badge variant={badgeVariant} className="mt-0.5 shrink-0">
              {VENUE_TYPE_LABELS[type]}
            </Badge>
          </div>

          {location && (
            <p className="mb-2 flex items-center gap-1 text-xs text-fg-muted">
              <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span className="line-clamp-1">{location}</span>
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            {/* Rating dots */}
            {personalRating != null && personalRating > 0 && (
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`h-2.5 w-2.5 ${
                      i < personalRating
                        ? "fill-accent-gold text-accent-gold"
                        : "fill-transparent text-fg-muted/30"
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
                className="ml-auto text-fg-muted transition-colors hover:text-accent-rose"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
              </a>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
