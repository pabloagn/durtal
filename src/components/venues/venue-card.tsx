"use client";

import { VENUE_TYPE_LABELS, VENUE_TYPE_BADGE_VARIANTS } from "@/lib/catalogue/venues";
import { CardHeading } from "@/components/shared/card-heading";
import { CapAligned } from "@/components/shared/cap-aligned";
import Link from "next/link";
import { ExternalLink, Star, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { VenueType } from "@/lib/catalogue/venues";
import { FadeImage } from "@/components/shared/fade-image";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
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
  /** Archived venues show only when the list asks for them */
  archived?: boolean;
}

export function VenueCard({
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
  color,
  archived = false,
}: VenueCardProps) {
  const href = `/places/${slug}`;
  const location = formattedAddress ?? placeName ?? null;
  const badgeVariant = VENUE_TYPE_BADGE_VARIANTS[type] ?? "muted";

  return (
    <div className="@container catalogue-card group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive">
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
          </div>
        </div>
      </Link>

      {/* Meta */}
      <div className="card-body">
          <CardHeading
            title={<Link href={href} tabIndex={-1}>{name}</Link>}
            subtitle={location ? <span className="flex gap-1"><CapAligned height={12}><MapPin className="h-3 w-3" strokeWidth={1.5} /></CapAligned><span>{location}</span></span> : null}
            subtitleClassName="text-xs text-fg-secondary"
            action={<FavouriteToggle favourite={isFavorite} target={{ entity: "venue", id }} name={name} />}
          />
          <div className="my-2"><Badge variant={badgeVariant}>{VENUE_TYPE_LABELS[type]}</Badge></div>
          <div className="flex min-h-4 flex-wrap items-center justify-between gap-2">
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

            {/* On every card width, unlike the type badge */}
            {archived && <span className="text-xs leading-4 text-fg-secondary">Archived</span>}

            {website && (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex h-7 w-7 items-center justify-center pointer-coarse:h-11 pointer-coarse:w-11 text-fg-secondary transition-colors hover:text-accent-primary"
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
