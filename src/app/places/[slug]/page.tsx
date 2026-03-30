import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Star,
  MapPin,
  Phone,
  Mail,
  Globe,
  Clock,
  AtSign,
  Tag,
} from "lucide-react";
import { getVenueBySlug } from "@/lib/actions/venues";
import { Badge } from "@/components/ui/badge";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const VENUE_TYPE_LABELS: Record<string, string> = {
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
  string,
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

export default async function VenueDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const venue = await getVenueBySlug(slug);

  if (!venue) notFound();

  const thumbnailUrl = venue.thumbnailS3Key
    ? `/api/s3/read?key=${encodeURIComponent(venue.thumbnailS3Key)}`
    : null;

  const posterUrl = venue.posterS3Key
    ? `/api/s3/read?key=${encodeURIComponent(venue.posterS3Key)}`
    : null;

  const displayImage = posterUrl ?? thumbnailUrl;
  const locationDisplay =
    venue.formattedAddress ??
    venue.place?.fullName ??
    venue.place?.name ??
    null;

  const badgeVariant = VENUE_TYPE_BADGE_VARIANTS[venue.type] ?? "muted";

  return (
    <>
      {/* Back navigation */}
      <Link
        href="/places"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to places
      </Link>

      {/* Header */}
      <div className="mb-8 flex gap-6">
        {/* Image */}
        {displayImage && (
          <div
            className="h-40 w-56 flex-shrink-0 overflow-hidden rounded-sm bg-bg-secondary"
            style={venue.color ? { backgroundColor: venue.color } : undefined}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayImage}
              alt={venue.name}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        {!displayImage && (
          <div
            className="flex h-40 w-56 flex-shrink-0 items-center justify-center rounded-sm border border-glass-border bg-bg-secondary"
            style={venue.color ? { backgroundColor: venue.color } : undefined}
          >
            <span className="font-serif text-4xl text-fg-muted/20">
              {venue.name[0]}
            </span>
          </div>
        )}

        {/* Title block */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-3">
            <h1 className="font-serif text-4xl tracking-tight text-fg-primary">
              {venue.name}
            </h1>
            {venue.isFavorite && (
              <Star
                className="h-5 w-5 shrink-0 fill-accent-gold text-accent-gold"
                strokeWidth={1.5}
              />
            )}
          </div>

          <div className="mb-3 flex items-center gap-2">
            <Badge variant={badgeVariant}>
              {VENUE_TYPE_LABELS[venue.type] ?? venue.type}
            </Badge>
            {venue.subtype && (
              <Badge variant="muted">{venue.subtype}</Badge>
            )}
          </div>

          {locationDisplay && (
            <p className="mb-2 flex items-center gap-1.5 text-sm text-fg-secondary">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-fg-muted" strokeWidth={1.5} />
              {locationDisplay}
            </p>
          )}

          {/* Personal rating */}
          {venue.personalRating != null && venue.personalRating > 0 && (
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-3.5 w-3.5 ${
                    i < (venue.personalRating ?? 0)
                      ? "fill-accent-gold text-accent-gold"
                      : "fill-transparent text-fg-muted/30"
                  }`}
                  strokeWidth={1.5}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {venue.description && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-xl text-fg-primary">About</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-fg-secondary">
            {venue.description}
          </p>
        </section>
      )}

      {/* Specialties and tags */}
      {(venue.specialties || (venue.tags && venue.tags.length > 0)) && (
        <section className="mb-8">
          {venue.specialties && (
            <div className="mb-3">
              <h2 className="mb-1.5 font-serif text-xl text-fg-primary">
                Specialties
              </h2>
              <p className="text-sm text-fg-secondary">{venue.specialties}</p>
            </div>
          )}
          {venue.tags && venue.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Tag className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.5} />
              {venue.tags.map((tag) => (
                <Badge key={tag} variant="muted">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Opening hours */}
      {venue.openingHours && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 font-serif text-xl text-fg-primary">
            <Clock className="h-4 w-4 text-fg-muted" strokeWidth={1.5} />
            Opening Hours
          </h2>
          <pre className="font-mono text-xs text-fg-secondary">
            {JSON.stringify(venue.openingHours, null, 2)}
          </pre>
        </section>
      )}

      {/* Contact info */}
      {(venue.phone || venue.email || venue.website || venue.instagramHandle) && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-xl text-fg-primary">Contact</h2>
          <div className="space-y-2">
            {venue.website && (
              <a
                href={venue.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-accent-rose transition-colors hover:underline"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                {venue.website}
              </a>
            )}
            {venue.phone && (
              <a
                href={`tel:${venue.phone}`}
                className="flex items-center gap-2 text-sm text-fg-secondary transition-colors hover:text-fg-primary"
              >
                <Phone className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                {venue.phone}
              </a>
            )}
            {venue.email && (
              <a
                href={`mailto:${venue.email}`}
                className="flex items-center gap-2 text-sm text-fg-secondary transition-colors hover:text-fg-primary"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                {venue.email}
              </a>
            )}
            {venue.instagramHandle && (
              <a
                href={`https://instagram.com/${venue.instagramHandle.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-accent-rose transition-colors hover:underline"
              >
                <AtSign className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                {venue.instagramHandle.startsWith("@")
                  ? venue.instagramHandle
                  : `@${venue.instagramHandle}`}
              </a>
            )}
          </div>
        </section>
      )}

      {/* Personal notes */}
      {venue.notes && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-xl text-fg-primary">Notes</h2>
          <p className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
            {venue.notes}
          </p>
        </section>
      )}

      {/* Visit history */}
      {(venue.firstVisitDate || venue.lastVisitDate) && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-xl text-fg-primary">
            Visit History
          </h2>
          <dl className="grid max-w-xs grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            {venue.firstVisitDate && (
              <>
                <dt className="text-xs text-fg-muted">First visit</dt>
                <dd className="text-sm text-fg-secondary">
                  {venue.firstVisitDate}
                </dd>
              </>
            )}
            {venue.lastVisitDate && (
              <>
                <dt className="text-xs text-fg-muted">Last visit</dt>
                <dd className="text-sm text-fg-secondary">
                  {venue.lastVisitDate}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* Map placeholder */}
      <section className="mb-8">
        <h2 className="mb-3 font-serif text-xl text-fg-primary">Map</h2>
        <div className="flex h-48 items-center justify-center rounded-sm border border-dashed border-glass-border bg-bg-secondary/50">
          <p className="text-sm text-fg-muted">
            Map integration coming soon (Task 0058)
          </p>
        </div>
      </section>
    </>
  );
}
