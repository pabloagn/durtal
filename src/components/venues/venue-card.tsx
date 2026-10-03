"use client";

import { VENUE_TYPE_LABELS, VENUE_TYPE_BADGE_VARIANTS } from "@/lib/catalogue/venues";
import { CapAligned } from "@/components/shared/cap-aligned";
import Link from "next/link";
import { ExternalLink, Star, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { VenueType } from "@/lib/catalogue/venues";
import { FadeImage } from "@/components/shared/fade-image";
import { PlacePlate } from "@/components/shared/no-photo";
import { cityFromAddress, streetFromAddress } from "@/lib/utils/address";



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
            className="relative aspect-[3/2] overflow-hidden bg-bg-tertiary"
            style={color ? { backgroundColor: color } : undefined}
          >
            {thumbnailUrl ? (
              <FadeImage
                src={thumbnailUrl}
                alt={name}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover group-hover:scale-[1.02]"
              />
            ) : (
              // A venue's own color stays its background
              <PlacePlate
                kind={VENUE_TYPE_LABELS[type]}
                city={cityFromAddress(formattedAddress)}
                street={streetFromAddress(formattedAddress)}
                tone={color ? undefined : badgeVariant}
              />
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
      <div className="p-3.5">
          {/* Fixed rows: every place card has the same height */}
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <h3 className="type-item-title lines-2 min-w-0">
              {/* Same link as the image above: one Tab stop per card */}
              <Link href={href} tabIndex={-1}>
                {name}
              </Link>
            </h3>
            {/* A narrow card gives the row to the name */}
            <span className="hidden @[220px]:contents">
              <Badge variant={badgeVariant} className="mt-0.5 shrink-0">
                {VENUE_TYPE_LABELS[type]}
              </Badge>
            </span>
          </div>

          <p className="mb-2 flex h-4 items-start gap-1 text-xs text-fg-secondary">
            {location && (
              <>
                <CapAligned height={12}><MapPin className="h-3 w-3 shrink-0" strokeWidth={1.5} /></CapAligned>
                <span className="lines-1 min-w-0">{location}</span>
              </>
            )}
          </p>

          <div className="flex h-4 items-center justify-between gap-2">
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
                aria-label={`Visit ${name} website`}
                data-tooltip={`Visit ${name} website`}
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
              </a>
            )}
          </div>
        </div>
    </div>
  );
}
