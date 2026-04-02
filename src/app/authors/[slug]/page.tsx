import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { getAuthorBySlug, getAuthors } from "@/lib/actions/authors";
import { Badge } from "@/components/ui/badge";
import { BookCard } from "@/components/books/book-card";
import { AuthorDetailHeader } from "./author-detail-header";
import { GallerySection } from "@/components/shared/gallery-section";
import { ActivityTimeline } from "@/components/activity/activity-timeline";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function AuthorDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const [author, allAuthorRows] = await Promise.all([
    getAuthorBySlug(slug),
    getAuthors({ limit: 5000 }),
  ]);

  if (!author) notFound();

  const allAuthors = allAuthorRows.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
  }));

  const works = author.workAuthors.map((wa) => ({
    ...wa.work,
    role: wa.role,
  }));

  const contributions = author.editionContributors.map((ec) => ({
    ...ec.edition,
    role: ec.role,
  }));

  const activePoster = author.media?.find(
    (m) => m.type === "poster" && m.isActive,
  );
  const poster = activePoster ?? author.media?.find((m) => m.type === "poster");
  const background = author.media?.find((m) => m.type === "background");
  const posterUrl = poster
    ? `/api/s3/read?key=${encodeURIComponent(poster.thumbnailS3Key ?? poster.s3Key)}`
    : null;
  const posterCrop = poster
    ? { x: poster.cropX, y: poster.cropY, zoom: poster.cropZoom }
    : null;

  const activeBackground = author.media?.find(
    (m) => m.type === "background" && m.isActive,
  );
  const bgMedia = activeBackground ?? background;
  const backgroundUrl = bgMedia
    ? `/api/s3/read?key=${encodeURIComponent(bgMedia.s3Key)}`
    : null;

  // Life dates display
  const lifeDates = (() => {
    if (!author.birthYear) return null;
    const birth = `${author.birthYearIsApproximate ? "c. " : ""}${author.birthYear}`;
    const death = author.deathYear
      ? `${author.deathYearIsApproximate ? "c. " : ""}${author.deathYear}`
      : "";
    return `${birth} - ${death}`;
  })();

  // Metadata fields for the detail grid
  const metadataFields: { label: string; value: string }[] = [];
  if (author.sortName)
    metadataFields.push({ label: "Sort Name", value: author.sortName });
  if (author.firstName)
    metadataFields.push({ label: "First Name", value: author.firstName });
  if (author.lastName)
    metadataFields.push({ label: "Last Name", value: author.lastName });
  if (author.realName)
    metadataFields.push({ label: "Real Name", value: author.realName });
  if (author.metadataSource)
    metadataFields.push({
      label: "Metadata Source",
      value: author.metadataSource,
    });

  return (
    <>
      {/* Cinematic backdrop + header */}
      <div className={bgMedia ? "relative -mx-6 -mt-6 mb-8" : ""}>
        {/* Background image layer */}
        {bgMedia && backgroundUrl && (
          <div className="absolute inset-0 -z-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={backgroundUrl}
              alt=""
              className="protected-image h-full w-full object-cover"
              style={{
                objectPosition: `${bgMedia.cropX}% ${bgMedia.cropY}%`,
                transform: `scale(${bgMedia.cropZoom / 100})`,
                transformOrigin: `${bgMedia.cropX}% ${bgMedia.cropY}%`,
              }}
            />
            {/* Dark overlay for readability */}
            <div className="absolute inset-0 bg-black/70" />
            {/* Bottom gradient: dissolves into the page background */}
            <div
              className="absolute inset-x-0 bottom-0 h-40"
              style={{
                background:
                  "linear-gradient(to top, var(--color-bg-primary) 0%, var(--color-bg-primary) 5%, transparent 100%)",
              }}
            />
          </div>
        )}

        {/* Content on top of the backdrop */}
        <div className={bgMedia ? "relative z-10 px-6 pt-6 pb-2" : ""}>
          <Link
            href="/authors"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
            Back to authors
          </Link>

          {/* Header with poster, name, edit/delete */}
          <AuthorDetailHeader
            authorId={author.id}
            name={author.name}
            firstName={author.firstName}
            lastName={author.lastName}
            realName={author.realName}
            countryName={author.country?.name}
            lifeDates={lifeDates}
            gender={author.gender}
            posterUrl={posterUrl}
            posterCrop={posterCrop}
            workCount={works.length}
            allAuthors={allAuthors}
          />
        </div>
      </div>

      {/* Bio */}
      {author.bio && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl text-fg-primary">About</h2>
          <div
            className="bio-content max-w-2xl text-sm leading-relaxed text-fg-secondary"
            dangerouslySetInnerHTML={{ __html: author.bio }}
          />
        </section>
      )}

      {/* Metadata grid */}
      {metadataFields.length > 0 && (
        <section className="mb-8">
          <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            {metadataFields.map((field) => (
              <div key={field.label} className="contents">
                <dt className="text-xs text-fg-muted">{field.label}</dt>
                <dd className="text-sm text-fg-secondary">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Works as author */}
      {works.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 font-serif text-2xl text-fg-primary">
            Works ({works.length})
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {works.map((work) => {
              const workActivePoster = work.media?.find(
                (m) => m.type === "poster" && m.isActive,
              );
              const coverKey =
                workActivePoster?.thumbnailS3Key ??
                workActivePoster?.s3Key ??
                work.editions[0]?.thumbnailS3Key;
              const coverUrl = coverKey
                ? `/api/s3/read?key=${encodeURIComponent(coverKey)}`
                : null;

              const instanceCount =
                work.editions[0]?.instances?.length ?? 0;

              const authorName =
                work.workAuthors[0]?.author?.name ?? author.name;

              return (
                <BookCard
                  key={work.id}
                  workId={work.id}
                  slug={work.slug ?? ""}
                  title={work.title}
                  authorName={authorName}
                  coverUrl={coverUrl}
                  coverCrop={
                    workActivePoster
                      ? { x: workActivePoster.cropX, y: workActivePoster.cropY, zoom: workActivePoster.cropZoom }
                      : null
                  }
                  publicationYear={work.editions[0]?.publicationYear}
                  language={work.editions[0]?.language}
                  instanceCount={instanceCount}
                  rating={work.rating}
                  catalogueStatus={work.catalogueStatus}
                  acquisitionPriority={work.acquisitionPriority}
                  primaryEditionId={work.editions[0]?.id}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Edition contributions */}
      {contributions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 font-serif text-2xl text-fg-primary">
            Edition Contributions ({contributions.length})
          </h2>
          <div className="space-y-2">
            {contributions.map((edition) => (
              <div
                key={`${edition.id}-${edition.role}`}
                className="flex items-center gap-4 rounded-sm border border-glass-border bg-bg-secondary px-4 py-3"
              >
                {edition.thumbnailS3Key ? (
                  <div className="relative h-12 w-8 flex-shrink-0 overflow-hidden rounded-sm bg-bg-primary">
                    <Image
                      src={`/api/s3/read?key=${encodeURIComponent(edition.thumbnailS3Key)}`}
                      alt={edition.title ?? "Edition cover"}
                      fill
                      sizes="32px"
                      className="protected-image object-cover"
                    unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex h-12 w-8 flex-shrink-0 items-center justify-center rounded-sm bg-bg-primary">
                    <span className="font-serif text-xs text-fg-muted/30">
                      {(edition.title ?? "?")[0]}
                    </span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <span className="font-serif text-base text-fg-primary">
                    {edition.title}
                  </span>
                  {edition.publicationYear && (
                    <span className="ml-2 font-mono text-xs text-fg-muted">
                      {edition.publicationYear}
                    </span>
                  )}
                </div>
                <Badge variant="blue">{edition.role}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Activity timeline */}
      <ActivityTimeline entityType="author" entityId={author.id} />

      {/* Gallery collage */}
      <GallerySection entityType="author" entityId={author.id} />

      {/* External links */}
      {(author.website || author.openLibraryKey || author.goodreadsId) && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl text-fg-primary">
            External Links
          </h2>
          <div className="flex gap-4">
            {author.website && (
              <a
                href={author.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-rose transition-colors hover:underline"
              >
                Website
              </a>
            )}
            {author.openLibraryKey && (
              <a
                href={`https://openlibrary.org${author.openLibraryKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-rose transition-colors hover:underline"
              >
                Open Library
              </a>
            )}
            {author.goodreadsId && (
              <a
                href={`https://www.goodreads.com/author/show/${author.goodreadsId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-rose transition-colors hover:underline"
              >
                Goodreads
              </a>
            )}
          </div>
        </section>
      )}
    </>
  );
}
