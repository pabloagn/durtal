import type { Metadata } from "next";
import { cache } from "react";
import { paginateItems, type ListSearchParams } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { getAuthorBySlug } from "@/lib/actions/authors";
import { Badge } from "@/components/ui/badge";
import { BookCard } from "@/components/books/book-card";
import { AuthorDetailHeader } from "./author-detail-header";
import { GallerySection } from "@/components/shared/gallery-section";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import { FullBleedLayer } from "@/components/shared/full-bleed-layer";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { SectionHeading } from "@/components/shared/section-heading";
import {
  DetailColumns,
  RecordField,
  RecordFields,
  RecordGroup,
  RecordPanel,
} from "@/components/shared/detail-layout";
import { Prose } from "@/components/shared/prose";
import { sanitizeDescriptionHtml } from "@/lib/utils/sanitize";
import { displayYear } from "@/lib/utils/years";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ListSearchParams>;
}

/** One read per request for the page and its title */
const loadAuthor = cache(getAuthorBySlug);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const author = await loadAuthor((await params).slug);
  return { title: author?.name ?? "Author not found" };
}

export default async function AuthorDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const author = await loadAuthor(slug);

  if (!author) notFound();

  const works = author.workAuthors.map((wa) => ({
    ...wa.work,
    role: wa.role,
  }));

  const paging = paginateItems(works, await searchParams);

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
    ? mediaCrop(poster)
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
    const birth = `${author.birthYearIsApproximate ? "c. " : ""}${displayYear(author.birthYear)}`;
    const death = author.deathYear
      ? `${author.deathYearIsApproximate ? "c. " : ""}${displayYear(author.deathYear)}`
      : "";
    return `${birth} - ${death}`;
  })();

  // Metadata fields for the detail grid
  const metadataFields: { label: string; value: string }[] = [];
  if (author.sortName)
    metadataFields.push({ label: "Sort name", value: author.sortName });
  if (author.firstName)
    metadataFields.push({ label: "First name", value: author.firstName });
  if (author.lastName)
    metadataFields.push({ label: "Last name", value: author.lastName });
  if (author.realName)
    metadataFields.push({ label: "Real name", value: author.realName });
  if (author.metadataSource)
    metadataFields.push({
      label: "Metadata source",
      value: author.metadataSource,
    });

  const links = [
    author.website && { label: "Website", href: author.website },
    author.openLibraryKey && {
      label: "Open Library",
      href: `https://openlibrary.org${author.openLibraryKey}`,
    },
    author.goodreadsId && {
      label: "Goodreads",
      href: `https://www.goodreads.com/author/show/${author.goodreadsId}`,
    },
  ].filter((link): link is { label: string; href: string } => !!link);
  const hasRecord = metadataFields.length > 0 || links.length > 0;
  const hasReading =
    !!author.bio || works.length > 0 || contributions.length > 0;

  return (
    <>
      <CopyShortcuts name={author.name} />
      {/* Cinematic backdrop + header */}
      <div className={bgMedia ? "relative -mx-6 -mt-6 mb-8" : ""}>
        {/* Background image layer: always spans the full main area */}
        {bgMedia && backgroundUrl && (
          <FullBleedLayer className="-z-0">
            <img
              src={backgroundUrl}
              alt=""
              className="protected-image h-full w-full object-cover"
              style={mediaImageStyle(mediaCrop(bgMedia))}
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
          </FullBleedLayer>
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
            countryCode={author.country?.alpha2}
            lifeDates={lifeDates}
            gender={author.gender}
            posterUrl={posterUrl}
            posterCrop={posterCrop}
            workCount={works.length}
          />
        </div>
      </div>

      {/* Reading column and, from lg up, the record on the right */}
      <DetailColumns
        record={
          hasRecord ? (
            <RecordPanel>
              {metadataFields.length > 0 && (
                <RecordGroup title="Details">
                  <RecordFields>
                    {metadataFields.map((field) => (
                      <RecordField key={field.label} label={field.label}>
                        {field.value}
                      </RecordField>
                    ))}
                  </RecordFields>
                </RecordGroup>
              )}
              {links.length > 0 && (
                <RecordGroup title="Links">
                  <ul className="space-y-1.5">
                    {links.map((link) => (
                      <li key={link.href}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-accent-rose-text transition-colors hover:text-fg-primary"
                        >
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </RecordGroup>
              )}
            </RecordPanel>
          ) : undefined
        }
      >
        {hasReading ? (
          <>
            {/* Bio */}
            {author.bio && (
              <section className="mb-8">
                <SectionHeading title="About" />
                {/* Sanitized like book descriptions: a bio can come from enrichment */}
                <Prose html={sanitizeDescriptionHtml(author.bio)} />
              </section>
            )}

            {/* Works as author */}
            {works.length > 0 && (
              <section className="mb-8">
                <SectionHeading title="Books" count={works.length} />
                <PaginatedSection {...paging} noun="books">
                <div
                  className={`grid grid-cols-2 gap-4 sm:grid-cols-3 ${hasRecord ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}
                >
                  {paging.items.map((work) => {
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
                        authorNames={work.workAuthors.map((wa) => wa.author.name)}
                        coverUrl={coverUrl}
                        coverCrop={
                          workActivePoster
                            ? mediaCrop(workActivePoster)
                            : null
                        }
                        coverTone={workActivePoster?.tone ?? null}
                        publicationYear={work.editions[0]?.publicationYear}
                        language={work.editions[0]?.language}
                        instanceCount={instanceCount}
                        rating={work.rating}
                        catalogueStatus={work.catalogueStatus}
                        acquisitionPriority={work.acquisitionPriority}
                        isRare={work.isRare}
                        huntAssessedOn={work.huntAssessedOn}
                        isPoison={work.isPoison}
                        primaryEditionId={work.editions[0]?.id}
                      />
                    );
                  })}
                </div>
                </PaginatedSection>
              </section>
            )}

            {/* Edition contributions */}
            {contributions.length > 0 && (
              <section className="mb-8">
                <SectionHeading title="Edition Contributions" count={contributions.length} />
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
                        <span className="type-item-title">
                          {edition.title}
                        </span>
                        {edition.publicationYear && (
                          <span className="ml-2 font-mono text-xs text-fg-secondary">
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
          </>
        ) : null}
      </DetailColumns>

      {/* Gallery collage */}
      <GallerySection entityType="author" entityId={author.id} />

      {/* Activity timeline */}
      <ActivityTimeline entityType="author" entityId={author.id} />
    </>
  );
}
