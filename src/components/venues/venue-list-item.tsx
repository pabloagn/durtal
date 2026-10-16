"use client";

import { VENUE_TYPE_LABELS } from "@/lib/catalogue/venues";
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";
import Link from "next/link";
import { FadeImage } from "@/components/shared/fade-image";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";
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
  // No photo, or one that fails: the name's letter, as every blank cover
  const blank = (
    <div className={`h-full ${COVER_BLANK}`}>
      <CoverLetter title={name} />
    </div>
  );

  const meta = (
    <>
      <Badge variant="muted">{VENUE_TYPE_LABELS[type]}</Badge>
      {archived && <Badge variant="muted">Archived</Badge>}
      {personalRating != null && personalRating > 0 && (
        // On the kind's cap height: the line is set in the badge's mono type,
        // as plain centring sits 0.75px off it in Chromium
        <CapAligned height={10} className="font-mono text-micro">
          <span className="flex gap-0.5" aria-label={`Rated ${personalRating} of 5`}>
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
          </span>
        </CapAligned>
      )}
    </>
  );

  // The name and address wrap in full. Under 640px the kind and rating go
  // under them, so the name has the row's width; from 640px they sit at the
  // row's end. The star and the website link sit on the name's first line.
  return (
    <div className="group relative flex items-start gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary">
      <Link
        href={`/places/${slug}`}
        className="flex min-w-0 flex-1 items-start gap-3"
      >
        {/* Small thumbnail */}
        <div className="relative h-10 w-14 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
          {thumbnailUrl ? (
            <FadeImage
              src={thumbnailUrl}
              alt={name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              fallback={blank}
            />
          ) : (
            blank
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <h3 className="type-item-title [overflow-wrap:anywhere] group-hover:text-accent-primary">
            {name}
          </h3>
          {location && (
            <p className="flex items-start gap-1 text-xs text-fg-secondary [overflow-wrap:anywhere]">
              <CapAligned height={10}><MapPin className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} /></CapAligned>
              <span className="min-w-0">{location}</span>
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 sm:hidden">{meta}</div>
        </div>

        {/* Meta */}
        <div className="type-item-title hidden flex-shrink-0 items-center gap-3 sm:flex">
          <span className="flex h-[1lh] items-center gap-3 font-sans">{meta}</span>
        </div>
      </Link>
      <CapAlignedControls height={32} coarseHeight={44} className="type-item-title">
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
            className="action-control flex icon-hit text-fg-secondary transition-colors hover:text-accent-primary"
            aria-label={`Visit ${name} website`}
            data-tooltip="Website"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
          </a>
        )}
      </CapAlignedControls>
    </div>
  );
}
