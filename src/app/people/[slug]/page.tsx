import type { Metadata } from "next";
import { cache } from "react";
import { paginateItems, type ListSearchParams } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { getAuthorBySlug, getPersonWorkCredits } from "@/lib/actions/authors";
import { DOMAIN_ORDER, WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
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
import { formatRating } from "@/lib/utils/rating";
import { formatReadingDate } from "@/lib/reading/dates";
import { cardReadingOf } from "@/lib/reading/card";
import { authorReadingTabOf, inReadingTab, readOfText, readingRecordOf } from "@/lib/reading/record";
import { ReadingTabSwitch } from "@/components/reading/reading-tab-switch";
import {
  countryDisplayName,
  enumLabel,
  metadataSourceLabel,
} from "@/lib/utils/labels";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ListSearchParams>;
}

/** One read per request for the page and its title */
const loadAuthor = cache(getAuthorBySlug);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const author = await loadAuthor((await params).slug);
  return { title: author?.name ?? "Person not found" };
}

export default async function AuthorDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const author = await loadAuthor(slug);

  if (!author) notFound();

  // Every collection's credits: the summary in the record, and a section for
  // each collection other than books (books keep their cards below)
  const credits = await getPersonWorkCredits(author.id);
  const byKind = new Map<WorkKind, typeof credits>();
  for (const c of credits) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const creditSummary = DOMAIN_ORDER.filter((kind) => byKind.has(kind)).map((kind) => {
    const roles = new Map<string, Set<string>>();
    for (const c of byKind.get(kind)!)
      roles.set(c.role, (roles.get(c.role) ?? new Set()).add(c.workId));
    return {
      kind,
      label: WORK_DOMAINS[kind].pluralLabel,
      roles: [...roles].map(([role, ids]) => `${role} ${ids.size}`).join(", "),
    };
  });
  const otherCollections = DOMAIN_ORDER.filter((kind) => kind !== "book" && byKind.has(kind)).map(
    (kind) => {
      const works = new Map<string, { title: string; href: string | null; roles: string[] }>();
      for (const c of byKind.get(kind)!) {
        const work = works.get(c.workId) ?? {
          title: c.title,
          href: c.slug ? `${WORK_DOMAINS[kind].basePath}/${c.slug}` : null,
          roles: [],
        };
        work.roles.push(c.role);
        works.set(c.workId, work);
      }
      return { kind, label: WORK_DOMAINS[kind].pluralLabel, works: [...works.values()] };
    },
  );

  const works = author.workAuthors.map((wa) => ({
    ...wa.work,
    role: wa.role,
  }));

  // Reading (SLN-449): "Read 7 of 12", the Reading record, and All / Unread / Reading / Read
  const query = await searchParams;
  const record = readingRecordOf(works);
  const readingTab = authorReadingTabOf(query.reading);
  const paging = paginateItems(
    works.filter((w) => inReadingTab(readingTab, w.readingState)),
    query,
  );

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
  if (author.gender)
    metadataFields.push({ label: "Gender", value: enumLabel(author.gender) });
  if (author.metadataSource)
    metadataFields.push({
      label: "Metadata source",
      value: metadataSourceLabel(author.metadataSource),
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
  const hasReadingRecord = record.read > 0;
  const hasRecord =
    metadataFields.length > 0 || links.length > 0 || creditSummary.length > 0 || hasReadingRecord;
  const hasReading =
    !!author.bio ||
    works.length > 0 ||
    contributions.length > 0 ||
    otherCollections.length > 0;

  return (
    <>
      <CopyShortcuts name={author.name} />
      {/* Cinematic backdrop + header */}
      <div className={bgMedia ? "relative -mx-4 -mt-6 mb-8 md:-mx-6" : ""}>
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
            <div className="absolute inset-0 bg-scrim" />
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
        <div className={bgMedia ? "relative z-10 px-4 pt-6 pb-2 md:px-6" : ""}>
          <Link
            href="/people"
            className="relative mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
            Back to people
          </Link>

          {/* Header with poster, name, edit/delete */}
          <AuthorDetailHeader
            authorId={author.id}
            name={author.name}
            firstName={author.firstName}
            lastName={author.lastName}
            realName={author.realName}
            countryName={countryDisplayName(author.country)}
            countryOfficialName={author.country?.name}
            countryCode={author.country?.alpha2}
            lifeDates={lifeDates}
            posterUrl={posterUrl}
            posterCrop={posterCrop}
            workCount={works.length}
            isFavourite={author.isFavourite}
          />
        </div>
      </div>

      {/* Reading column and, from lg up, the record on the right */}
      <DetailColumns
        record={
          hasRecord ? (
            <RecordPanel>
              {creditSummary.length > 0 && (
                <RecordGroup title="Credits">
                  <RecordFields>
                    {creditSummary.map((group) => (
                      <RecordField key={group.kind} label={group.label}>
                        {group.roles}
                      </RecordField>
                    ))}
                  </RecordFields>
                </RecordGroup>
              )}
              {hasReadingRecord && (
                <RecordGroup title="Reading">
                  <RecordFields>
                    <RecordField label="Read">{`${record.read} of ${record.total}`}</RecordField>
                    {record.rereads > 0 && (
                      <RecordField label="Re-read">{`${record.rereads} ${record.rereads === 1 ? "book" : "books"}`}</RecordField>
                    )}
                    {record.average !== null && <RecordField label="Your average">{formatRating(record.average)}</RecordField>}
                    {record.lastReadAt && (
                      <RecordField label="Last read">{formatReadingDate(record.lastReadAt.slice(0, 10), "day")}</RecordField>
                    )}
                  </RecordFields>
                </RecordGroup>
              )}
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
                <SectionHeading title="Books" count={works.length} description={readOfText(record)} />
                {record.read > 0 && (
                  <div className="mb-4">
                    <ReadingTabSwitch value={readingTab} />
                  </div>
                )}
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
                        isFavourite={work.isFavourite}
                        primaryEditionId={work.editions[0]?.id}
                        reading={cardReadingOf(work)}
                      />
                    );
                  })}
                </div>
                </PaginatedSection>
              </section>
            )}

            {/* Films, perfumes and paintings */}
            {otherCollections.map((group) => (
              <section key={group.kind} className="mb-8">
                <SectionHeading title={group.label} count={group.works.length} />
                <ul className="space-y-2">
                  {group.works.map((work) => (
                    <li
                      key={`${work.href ?? work.title}`}
                      className="flex items-start gap-4 rounded-sm border border-glass-border bg-bg-secondary px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        {work.href ? (
                          <Link
                            href={work.href}
                            className="type-item-title transition-colors hover:text-accent-rose-text"
                          >
                            {work.title}
                          </Link>
                        ) : (
                          <span className="type-item-title">{work.title}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {work.roles.map((role) => (
                          <Badge key={role} variant="blue">
                            {role}
                          </Badge>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

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
                      <Badge variant="blue">{enumLabel(edition.role)}</Badge>
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
