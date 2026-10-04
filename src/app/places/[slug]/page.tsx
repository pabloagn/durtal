import { CapAligned } from "@/components/shared/cap-aligned";
import { SectionHeading } from "@/components/shared/section-heading";
import {
  DetailColumns,
  RecordField,
  RecordFields,
  RecordGroup,
  RecordPanel,
} from "@/components/shared/detail-layout";
import { Prose } from "@/components/shared/prose";
import { VENUE_TYPE_LABELS, VENUE_TYPE_BADGE_VARIANTS } from "@/lib/catalogue/venues";
import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Star,
  MapPin,
  Phone,
  Mail,
  Globe,
  AtSign,
  Tag,
} from "lucide-react";
import { getVenueBySlug } from "@/lib/actions/venues";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";

interface PageProps {
  params: Promise<{ slug: string }>;
}



async function PlaceContent({ slug }: { slug: string }) {
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
  const hasTags = !!venue.tags && venue.tags.length > 0;
  const hasContact = !!(
    venue.phone ||
    venue.email ||
    venue.website ||
    venue.instagramHandle
  );
  const hasVisits = !!(venue.firstVisitDate || venue.lastVisitDate);
  const hasHours = venue.openingHours != null;
  const hasReading = !!(
    venue.description ||
    venue.specialties ||
    hasTags ||
    venue.notes
  );

  return (
    <>
      <CopyShortcuts name={venue.name} address={venue.formattedAddress} />
      {/* Back navigation */}
      <Link
        href="/places"
        className="mb-6 inline-flex items-start gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <CapAligned height={12}><ArrowLeft className="h-3 w-3" strokeWidth={1.5} /></CapAligned>
        Back to places
      </Link>

      {/* Header */}
      <div className="mb-8 flex flex-col gap-6 sm:flex-row">
        {/* Image */}
        {displayImage && (
          <div
            className="relative h-40 w-56 flex-shrink-0 overflow-hidden rounded-sm bg-bg-secondary"
            style={venue.color ? { backgroundColor: venue.color } : undefined}
          >
            <img
              src={displayImage}
              alt={venue.name}
              className="h-full w-full object-cover"
            />
            <ImageAdjustButton source={displayImage} className="absolute bottom-2 right-2" />
          </div>
        )}

        {!displayImage && (
          <div
            className="flex h-40 w-56 flex-shrink-0 items-center justify-center rounded-sm border border-glass-border bg-bg-secondary"
            style={venue.color ? { backgroundColor: venue.color } : undefined}
          >
            <span aria-hidden="true" className="font-serif text-4xl text-fg-secondary">
              {venue.name[0]}
            </span>
          </div>
        )}

        {/* Title block */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-start gap-3 font-serif text-4xl tracking-tight">
            <h1 className="type-page-title">
              {venue.name}
            </h1>
            {venue.isFavorite && (
              <CapAligned height={16}><Star className="h-4 w-4 shrink-0 fill-accent-gold text-accent-gold" strokeWidth={1.5} /></CapAligned>
            )}
          </div>

          <div className="mb-3 flex items-center gap-2">
            <Badge variant={badgeVariant}>
              {VENUE_TYPE_LABELS[venue.type] ?? venue.type}
            </Badge>
            {venue.archivedAt && <Badge variant="muted">Archived</Badge>}
            {venue.subtype && (
              <Badge variant="muted">{venue.subtype}</Badge>
            )}
          </div>

          {locationDisplay && (
            <p className="mb-2 flex items-start gap-1.5 text-sm text-fg-secondary">
              <CapAligned height={14}><MapPin className="h-3.5 w-3.5 shrink-0 text-fg-muted" strokeWidth={1.5} /></CapAligned>
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

      {/* Reading column and, from lg up, the record on the right */}
      <DetailColumns
        record={
          hasContact || hasHours || hasVisits ? (
            <RecordPanel>
              {hasContact && (
                <RecordGroup title="Contact">
                  <div className="space-y-2">
                    {venue.website && (
                      <a
                        href={venue.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-2 break-all text-sm text-accent-rose-text transition-colors hover:underline"
                      >
                        <CapAligned height={14}><Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} /></CapAligned>
                        {venue.website}
                      </a>
                    )}
                    {venue.phone && (
                      <a
                        href={`tel:${venue.phone}`}
                        className="flex items-start gap-2 break-all text-sm text-fg-secondary transition-colors hover:text-fg-primary"
                      >
                        <CapAligned height={14}><Phone className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} /></CapAligned>
                        {venue.phone}
                      </a>
                    )}
                    {venue.email && (
                      <a
                        href={`mailto:${venue.email}`}
                        className="flex items-start gap-2 break-all text-sm text-fg-secondary transition-colors hover:text-fg-primary"
                      >
                        <CapAligned height={14}><Mail className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} /></CapAligned>
                        {venue.email}
                      </a>
                    )}
                    {venue.instagramHandle && (
                      <a
                        href={`https://instagram.com/${venue.instagramHandle.replace(/^@/, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-2 break-all text-sm text-accent-rose-text transition-colors hover:underline"
                      >
                        <CapAligned height={14}><AtSign className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} /></CapAligned>
                        {venue.instagramHandle.startsWith("@")
                          ? venue.instagramHandle
                          : `@${venue.instagramHandle}`}
                      </a>
                    )}
                  </div>
                </RecordGroup>
              )}
              {hasHours && (
                <RecordGroup title="Opening hours">
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-fg-secondary">
                    {JSON.stringify(venue.openingHours, null, 2)}
                  </pre>
                </RecordGroup>
              )}
              {hasVisits && (
                <RecordGroup title="Visits">
                  <RecordFields>
                    {venue.firstVisitDate && (
                      <RecordField label="First visit">
                        {venue.firstVisitDate}
                      </RecordField>
                    )}
                    {venue.lastVisitDate && (
                      <RecordField label="Last visit">
                        {venue.lastVisitDate}
                      </RecordField>
                    )}
                  </RecordFields>
                </RecordGroup>
              )}
            </RecordPanel>
          ) : undefined
        }
      >
        {hasReading ? (
          <>
            {venue.description && (
              <section className="mb-8">
                <SectionHeading title="About" />
                <Prose className="whitespace-pre-wrap">{venue.description}</Prose>
              </section>
            )}

            {/* Specialties and tags */}
            {(venue.specialties || hasTags) && (
              <section className="mb-8">
                {venue.specialties && (
                  <SectionHeading
                    title="Specialties"
                    description={venue.specialties}
                  />
                )}
                {hasTags && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.5} />
                    {venue.tags!.map((tag) => (
                      <Badge key={tag} variant="muted">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Personal notes */}
            {venue.notes && (
              <section className="mb-8">
                <SectionHeading title="Notes" />
                <p className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
                  {venue.notes}
                </p>
              </section>
            )}
          </>
        ) : null}
      </DetailColumns>
    </>
  );
}

export default async function VenueDetailPage({ params }: PageProps) {
  const { slug } = await params;

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      }
    >
      <PlaceContent slug={slug} />
    </Suspense>
  );
}
