import type { Metadata } from "next";
import { ebooksAvailableText, lifeDates, lifeEvent } from "@/lib/utils/format";
import { catalogueAvailability } from "@/lib/ebooks/catalogue-availability";
import { getAuthorEbookSuggestionCount } from "@/lib/ebooks/review-queue/suggestions";
import { EbookSuggestionLine } from "@/components/ebooks/ebook-suggestion-line";
import { pageHref } from "@/lib/utils/pagination";
import { cache, type ReactNode } from "react";
import { paginateItems, type ListSearchParams } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { notFound } from "next/navigation";
import Link from "next/link";
import { FadeImage } from "@/components/shared/fade-image";
import { ArrowLeft } from "lucide-react";
import { getAuthorBySlug, getPersonBookCards, getPersonBooks, getPersonWorkCredits } from "@/lib/actions/authors";
import { getPersonNoteCounts } from "@/lib/actions/reading-notes";
import { notesHref } from "@/lib/reading/notes-params";
import { notesCountText } from "@/lib/reading/notes-text";
import { DOMAIN_ORDER, WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { compareCreditRoles } from "@/lib/catalogue/credits";
import { Badge } from "@/components/ui/badge";
import { BookCard } from "@/components/books/book-card";
import { FilmCard } from "@/components/films/film-card";
import { PerfumeCard } from "@/components/perfumes/perfume-card";
import { PaintingCard } from "@/components/paintings/painting-card";
import { loadFilmCards } from "@/lib/catalogue/film-store";
import { loadPerfumeCards } from "@/lib/catalogue/perfume-store";
import { loadPaintingCards } from "@/lib/catalogue/painting-store";
import { AuthorDetailHeader } from "./author-detail-header";
import { GallerySection, preloadGallery } from "@/components/shared/gallery-section";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import { FullBleedLayer } from "@/components/shared/full-bleed-layer";
import backdropStyles from "./author-backdrop.module.css";
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
import { PhonePairGrid } from "@/components/shared/phone-pair-grid";
import { mediaUrl } from "@/lib/s3/media-url";

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
  // The person and their books at once (SLN-1078)
  const [author, works, query] = await Promise.all([loadAuthor(slug), getPersonBooks(slug), searchParams]);

  if (!author) notFound();

  // Reading (SLN-449): "Read 7 of 12", the Reading record, and All / Unread / Reading / Read
  const record = readingRecordOf(works);
  const readingTab = authorReadingTabOf(query.reading);
  const paging = paginateItems(
    works.filter((w) => inReadingTab(readingTab, w.readingState)),
    query,
  );

  // Everything that needs only the person, at once: the gallery (rendered at
  // the foot), and this page's book cards with which books have an e-book
  preloadGallery("author", author.id);
  // Every collection's credits: the summary in the record, and a section for
  // each collection other than books (books keep their cards below)
  const [credits, noteCounts, ebookSuggestions, bookCards, digital] = await Promise.all([
    getPersonWorkCredits(author.id),
    getPersonNoteCounts(author.id),
    getAuthorEbookSuggestionCount(author.id),
    getPersonBookCards(paging.items.map((work) => work.id)),
    catalogueAvailability(works.map((work) => work.id)),
  ]);
  const byKind = new Map<WorkKind, typeof credits>();
  for (const c of credits) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  // Roles in one fixed order, Author first, not in the order of the titles
  const byRole = [...credits].sort(compareCreditRoles);
  const creditSummary = DOMAIN_ORDER.filter((kind) => byKind.has(kind)).map((kind) => {
    const roles = new Map<string, Set<string>>();
    for (const c of byRole.filter((c) => c.kind === kind))
      roles.set(c.role, (roles.get(c.role) ?? new Set()).add(c.workId));
    return {
      kind,
      label: WORK_DOMAINS[kind].pluralLabel,
      // "Author · 2 books", one role a line: a bare "Author 2" read as a name
      roles: [...roles].map(([role, ids]) => `${role} · ${ids.size.toLocaleString("en")} ${ids.size === 1 ? WORK_DOMAINS[kind].label.toLowerCase() : WORK_DOMAINS[kind].pluralLabel.toLowerCase()}`),
    };
  });
  // Films, perfumes and paintings as their collections' cards, like the books
  // below; the person's roles on each go under its card
  const creditRoles = new Map<string, string[]>();
  for (const c of byRole)
    if (c.kind !== "book") creditRoles.set(c.workId, [...(creditRoles.get(c.workId) ?? []), c.role]);
  const idsOf = (kind: WorkKind) => [...new Set((byKind.get(kind) ?? []).map((c) => c.workId))];
  const [films, perfumes, paintings] = await Promise.all([
    loadFilmCards(idsOf("film")),
    loadPerfumeCards(idsOf("perfume")),
    loadPaintingCards(idsOf("painting")),
  ]);
  const otherCards: Partial<Record<WorkKind, { id: string; card: ReactNode }[]>> = {
    film: films.map((film) => ({ id: film.id, card: <FilmCard film={film} /> })),
    perfume: perfumes.map((perfume) => ({ id: perfume.id, card: <PerfumeCard perfume={perfume} /> })),
    painting: paintings.map((painting) => ({ id: painting.id, card: <PaintingCard painting={painting} /> })),
  };
  const otherCollections = DOMAIN_ORDER.filter((kind) => otherCards[kind]?.length).map((kind) => ({
    kind,
    label: WORK_DOMAINS[kind].pluralLabel,
    cards: otherCards[kind]!,
  }));

  const digitalCount = [...digital.values()].filter((value) => value.read).length;
  const readerReturnTo = pageHref(`/people/${slug}`, query, paging.page);

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
    ? mediaUrl(poster.thumbnailS3Key ?? poster.s3Key)
    : null;
  const posterCrop = poster
    ? mediaCrop(poster)
    : null;

  const activeBackground = author.media?.find(
    (m) => m.type === "background" && m.isActive,
  );
  const bgMedia = activeBackground ?? background;
  const backgroundUrl = bgMedia
    ? mediaUrl(bgMedia.s3Key)
    : null;

  // Metadata fields for the detail grid: first the birth and death, as
  // precise as they are known, with their places (SLN-1006)
  const metadataFields: { label: string; value: string }[] = [];
  const born = lifeEvent({
    year: author.birthYear, month: author.birthMonth, day: author.birthDay,
    approximate: author.birthYearIsApproximate, place: author.birthPlace?.name,
  });
  const died = lifeEvent({
    year: author.deathYear, month: author.deathMonth, day: author.deathDay,
    approximate: author.deathYearIsApproximate, place: author.deathPlace?.name,
  });
  if (born) metadataFields.push({ label: "Born", value: born });
  if (died) metadataFields.push({ label: "Died", value: died });
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
  // Quotes on their books, and from editions they translated (SLN-480)
  const quotesText = notesCountText(noteCounts.quotes, noteCounts.notes);
  const translatedText = notesCountText(noteCounts.translatedQuotes, noteCounts.translatedNotes);
  const hasReadingRecord = record.read > 0 || !!quotesText || !!translatedText;
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
          <FullBleedLayer className="isolate -z-0 pointer-events-none">
            <FadeImage
              src={backgroundUrl}
              alt=""
              className="protected-image h-full w-full object-cover"
              style={mediaImageStyle(mediaCrop(bgMedia))}
              fallback={null}
            />
            {/* Static grain belongs only to this backdrop, beneath both fades. */}
            <div aria-hidden="true" className={backdropStyles.grain} />
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
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
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
            lifeDates={lifeDates(author)}
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
                        {group.roles.map((role) => (
                          <span key={role} className="block" data-person-credit="">{role}</span>
                        ))}
                      </RecordField>
                    ))}
                  </RecordFields>
                </RecordGroup>
              )}
              {hasReadingRecord && (
                <RecordGroup title="Reading">
                  <RecordFields>
                    {record.read > 0 && <RecordField label="Read">{`${record.read} of ${record.total}`}</RecordField>}
                    {record.rereads > 0 && (
                      <RecordField label="Re-read">{`${record.rereads} ${record.rereads === 1 ? "book" : "books"}`}</RecordField>
                    )}
                    {record.average !== null && <RecordField label="Your average">{formatRating(record.average)}</RecordField>}
                    {record.lastReadAt && (
                      <RecordField label="Last read">{formatReadingDate(record.lastReadAt.slice(0, 10), "day")}</RecordField>
                    )}
                    {quotesText && (
                      <RecordField label="Quotes">
                        <Link href={notesHref({ authorId: author.id })} className="transition-colors hover:text-accent-primary" data-person-quotes="">
                          {quotesText}
                        </Link>
                      </RecordField>
                    )}
                    {translatedText && (
                      <RecordField label="From translations">
                        <Link href={notesHref({ translatorId: author.id })} className="transition-colors hover:text-accent-primary" data-person-translated-quotes="">
                          {translatedText}
                        </Link>
                      </RecordField>
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
                          className="text-sm text-command"
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
            <EbookSuggestionLine authorId={author.id} count={ebookSuggestions} className="mb-8" />
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
                <SectionHeading title="Books" count={works.length} description={[readOfText(record), digitalCount ? ebooksAvailableText(digitalCount) : null].filter(Boolean).join(" · ")} />
                {record.read > 0 && (
                  <div className="mb-4">
                    <ReadingTabSwitch value={readingTab} />
                  </div>
                )}
                <PaginatedSection {...paging} noun="books">
                {/* Two cards a row on a phone, as every other cover grid;
                    every book shows, as the pager counts them (SLN-1019) */}
                <PhonePairGrid endOnFullRow={false}>
                  {bookCards.map((work) => {
                    // The active poster, else the first edition's cover, as in the library
                    const workActivePoster = work.media[0];
                    const coverKey =
                      workActivePoster?.thumbnailS3Key ??
                      workActivePoster?.s3Key ??
                      work.editions[0]?.thumbnailS3Key;
                    const coverUrl = coverKey
                      ? mediaUrl(coverKey)
                      : null;

                    const instanceCount = work.editions[0]?.instances.length ?? 0;

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
                        ebook={digital.get(work.id)?.read ?? null}
                        readerReturnTo={readerReturnTo}
                      />
                    );
                  })}
                </PhonePairGrid>
                </PaginatedSection>
              </section>
            )}

            {/* Films, perfumes and paintings */}
            {otherCollections.map((group) => (
              <section key={group.kind} className="mb-8">
                <SectionHeading title={group.label} count={group.cards.length} />
                <PhonePairGrid endOnFullRow={false}>
                  {group.cards.map(({ id, card }) => (
                    // The card fills the cell above its caption, so the
                    // caption stays in the cell, not over the next row (SLN-1019)
                    <div key={id} className="grid h-full grid-rows-[1fr_auto]">
                      <div className="min-h-0">{card}</div>
                      {/* The person's roles on it, as a related row's caption */}
                      <p className="mt-1.5 lines-2 text-micro text-fg-secondary">
                        {creditRoles.get(id)?.join(", ")}
                      </p>
                    </div>
                  ))}
                </PhonePairGrid>
              </section>
            ))}

            {/* Edition contributions */}
            {contributions.length > 0 && (
              <section className="mb-8">
                <SectionHeading title="Edition contributions" count={contributions.length} />
                <div className="space-y-2">
                  {contributions.map((edition) => (
                    <div
                      key={`${edition.id}-${edition.role}`}
                      className="flex items-center gap-4 rounded-sm border border-glass-border bg-bg-secondary px-4 py-3"
                    >
                      {edition.thumbnailS3Key ? (
                        <div className="relative flex h-12 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-primary">
                          <FadeImage
                            src={mediaUrl(edition.thumbnailS3Key)}
                            alt={edition.title ?? "Edition cover"}
                            loading="lazy"
                            decoding="async"
                            className="protected-image absolute inset-0 h-full w-full object-cover"
                            // A cover that fails shows the title's letter, as with none
                            fallback={
                              <span aria-hidden="true" data-decorative className="font-serif text-xs text-fg-muted/30">
                                {(edition.title ?? "?")[0]}
                              </span>
                            }
                          />
                        </div>
                      ) : (
                        <div className="flex h-12 w-8 flex-shrink-0 items-center justify-center rounded-sm bg-bg-primary">
                          <span aria-hidden="true" data-decorative className="font-serif text-xs text-fg-muted/30">
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
