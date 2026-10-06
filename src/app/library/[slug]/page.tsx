import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getReadingsForWork } from "@/lib/actions/reading";
import { getNotesForWork } from "@/lib/actions/reading-notes";
import { NotesSection } from "@/components/reading/notes-section";
import { slimNote } from "@/lib/reading/notes-text";
import { readingEstimates } from "@/lib/reading/estimates";
import { getQueuePlace } from "@/lib/actions/reading-queue";
import { ReadingProvider } from "@/components/reading/reading-provider";
import { ReadingThen } from "@/components/reading/reading-then";
import { addBookParams } from "@/lib/reading/book-picker";
import { ReadingControl } from "@/components/reading/reading-control";
import { ReadingSection } from "@/components/reading/reading-section";
import { readingEditions, readingHomes } from "@/lib/reading/page-data";
import { readingRecord } from "@/lib/reading/labels";
import { readingDay } from "@/lib/reading/dates";
import { readingDayStartHour } from "@/lib/reading/day";
import { canUseWorkCapability } from "@/lib/catalogue/domains";
import { appTimeZone } from "@/lib/utils/date";
import { READING_HOME_KEY } from "@/lib/preferences";
import { EstimateInfo } from "@/components/reading/estimate-info";
import { getSuggestionContext, predictionGateOn } from "@/lib/reading/suggest/context";
import { predict, predictionSource, predictionText } from "@/lib/reading/suggest/predict";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { RatingStars } from "@/components/shared/rating";
import { formatRating } from "@/lib/utils/rating";
import { cache } from "react";
import { CollectionButton } from "@/components/books/add-to-collection-dialog";
import { CopyBookButton } from "@/components/books/copy-book-button";
import {
  getAcquisitionTargets,
} from "@/lib/actions/publishers";
import { AcquisitionTargets } from "@/components/publishers/acquisition-targets";
import { notFound } from "next/navigation";
import Link from "next/link";
import { HuntAssessmentControl } from "@/components/books/hunt-assessment-control";
import { PoisonToggle } from "@/components/books/poison-toggle";
import { BookLinks } from "@/components/books/book-links";
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  getWorkBySlug,
  getWorksByAuthorId,
  getWorksWithMark,
} from "@/lib/actions/works";
import { MARKS_LABEL, marksOf, otherMarkedTitle } from "@/lib/constants/marks";
import { getOrdersForWork } from "@/lib/actions/orders";
import { getSeries, getOtherWorksInSeries } from "@/lib/actions/series";
import {
  getWorkTypes,
  getSubjects,
  getCategories,
  getThemes,
  getLiteraryMovements,
  getArtTypes,
  getArtMovements,
  getKeywords,
  getAttributes,
  getGenres,
  getTags,
} from "@/lib/actions/taxonomy";
import { getLocations } from "@/lib/actions/locations";
import { getRecommenders } from "@/lib/actions/recommenders";
import { getCalibreBooksByWorkId } from "@/lib/calibre/queries";
import { sanitizeDescriptionHtml } from "@/lib/utils/sanitize";
import { ReadButton } from "@/components/reader/read-button";
import { Badge } from "@/components/ui/badge";
import { priorityVariant } from "@/lib/constants/catalogue";
import { WorkRecord } from "./work-record";
import { EditionDetailCard } from "./edition-detail-card";
import { EditionAddDialog } from "./edition-add-dialog";
import { WorkActionsMenu } from "./work-actions-menu";
import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import {
  getCollectionsForWork,
  getCollectionCoverPreviews,
} from "@/lib/actions/collections";
import {
  CollectionCard,
  collectionPoster,
} from "@/components/collections/collection-card";
import { WorkCarousel } from "@/components/books/work-carousel";
import { getSimilarWorks } from "@/lib/actions/similar-works";
import { WorkPosterImage } from "./work-poster-image";
import { GallerySection } from "@/components/shared/gallery-section";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { AmbientCrystals } from "./ambient-crystals";
import type { CrystalColor, ColorPalette } from "@/lib/types";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { formatBookClipboardText } from "@/lib/utils/copy-book";
import { SectionHeading } from "@/components/shared/section-heading";
import { Prose } from "@/components/shared/prose";
import { DetailColumns } from "@/components/shared/detail-layout";
import { LinkedWorksSection } from "@/components/catalogue/work-relations";
import { getWorkRelations } from "@/lib/actions/work-relations";
import { catalogueStatusLabel, priorityLabel } from "@/lib/utils/labels";
import { languageName } from "@/lib/utils/language";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ then?: string | string[] }>;
}

/** A book still looked for: its hunting block shows even with no target */
const HUNTED_STATUSES = new Set(["wanted", "shortlisted", "tracked"]);

function catalogueStatusVariant(
  status: string,
): "sage" | "gold" | "red" | "blue" | "muted" {
  switch (status) {
    case "accessioned":
      return "sage";
    case "wanted":
    case "shortlisted":
      return "gold";
    case "deaccessioned":
      return "red";
    case "on_order":
      return "blue";
    default:
      return "muted";
  }
}

/** One read per request for the page and its title */
const loadWork = cache(getWorkBySlug);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const work = await loadWork((await params).slug);
  if (!work) return { title: "Book not found" };
  const authors = work.workAuthors.map((wa) => wa.author.name).join(", ");
  return { title: authors ? `${work.title} by ${authors}` : work.title };
}

export default async function WorkDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  // ?then=start or ?then=past: open that reading dialog on arrival (SLN-448)
  const { then } = addBookParams((await searchParams) ?? {});

  const [
    work,
    allSeries,
    allWorkTypes,
    allSubjects,
    allCategories,
    allThemes,
    allLiteraryMovements,
    allArtTypes,
    allArtMovements,
    allKeywords,
    allAttributes,
    allLocations,
    allGenres,
    allTags,
    allRecommenders,
  ] = await Promise.all([
    loadWork(slug),
    getSeries(),
    getWorkTypes(),
    getSubjects(),
    getCategories(),
    getThemes(),
    getLiteraryMovements(),
    getArtTypes(),
    getArtMovements(),
    getKeywords(),
    getAttributes(),
    getLocations(),
    getGenres(),
    getTags(),
    getRecommenders(),
  ]);

  if (!work) notFound();

  // Get orders, calibre books, and related works for this work
  const primaryAuthor = work.workAuthors[0]?.author;
  const [
    workOrders,
    digitalBooks,
    relatedWorks,
    acquisitionTargets,
    workCollections,
    similarWorks,
    markRows,
    seriesWorks,
    links,
    readingRows,
    readingNotes,
  ] = await Promise.all([
    getOrdersForWork(work.id),
    getCalibreBooksByWorkId(work.id),
    primaryAuthor
      ? getWorksByAuthorId(primaryAuthor.id, work.id, 12)
      : Promise.resolve([]),
    getAcquisitionTargets(work.id),
    getCollectionsForWork(work.id),
    getSimilarWorks(work.id, 12),
    // One row of other books for each mark this book has
    Promise.all(
      marksOf(work).map(async (mark) => ({
        mark,
        works: await getWorksWithMark(mark.key, work.id, 12),
      })),
    ),
    work.seriesId
      ? getOtherWorksInSeries(work.seriesId, work.id)
      : Promise.resolve([]),
    getWorkRelations(work.id),
    getReadingsForWork(work.id),
    // Quotes and notes (SLN-453): books only
    canUseWorkCapability(work.kind, "reading") ? getNotesForWork(work.id) : Promise.resolve([]),
  ]);
  const readingCounts = {
    readings: readingRows.length,
    sessions: readingRows.reduce((sum, r) => sum + r.sessionCount, 0),
    quotes: readingNotes.filter((n) => n.kind === "quote").length,
    notes: readingNotes.filter((n) => n.kind === "note").length,
  };
  // The reading control, section and dialogs (SLN-447)
  const canRead = canUseWorkCapability(work.kind, "reading");
  const zone = appTimeZone();
  const dayStartHour = await readingDayStartHour();
  const today = readingDay(new Date(), zone, dayStartHour);
  let homeCookie: string | null = null;
  try {
    const raw = (await cookies()).get(READING_HOME_KEY)?.value;
    homeCookie = raw ? (JSON.parse(raw) as string | null) : null;
  } catch {
    homeCookie = null;
  }
  const readingData = {
    workId: work.id,
    workTitle: work.title,
    bookRating: work.rating ?? null,
    dayStartHour,
    rows: readingRows,
    editions: readingEditions(work.editions, { today, homeId: homeCookie && homeCookie !== "none" ? homeCookie : null }),
    homes: readingHomes(allLocations),
    today,
    zone,
    // Time left and the finish date of the open reading (SLN-451)
    // The book's place in Up Next (SLN-452)
    queuePlace: (await getQueuePlace(work.id))?.place ?? null,
    estimates: await readingEstimates(
      readingRows.filter((r) => r.reading.status === "reading" || r.reading.status === "paused").map((r) => r.reading.id),
      today,
    ),
  };
  // The predicted rating of an unread book (SLN-457): only while the gate is on, and only with enough similar books
  let prediction: { text: string; why: string } | null = null;
  if (canRead && !readingRows.some((r) => r.reading.status === "finished") && (await predictionGateOn())) {
    const ctx = await getSuggestionContext({ homeId: homeCookie });
    const book = ctx.byId.get(work.id);
    const p = book && ctx.gate?.on ? predict(book, ctx) : null;
    if (p)
      prediction = {
        text: `You would ${predictionText(p).replace("likely", "likely rate it")}`,
        why: `${predictionSource(p).replace(/^from/, "From")}.\n\n${p.neighbours.map((x) => `${x.book.title}: ${formatRating(x.rating)}`).join("\n")}`,
      };
  }
  // Member-cover collage only for collections without a poster
  const collectionCovers = await getCollectionCoverPreviews(
    workCollections.filter((c) => !collectionPoster(c.media)).map((c) => c.id),
  );

  const primaryAuthors = work.workAuthors.map((wa) => wa.author);
  const poster = work.media?.find((m) => m.type === "poster" && m.isActive);
  const background = work.media?.find(
    (m) => m.type === "background" && m.isActive,
  );
  const allPosters = work.media?.filter((m) => m.type === "poster") ?? [];
  const allBackgrounds =
    work.media?.filter((m) => m.type === "background") ?? [];
  const galleryMedia = work.media?.filter((m) => m.type === "gallery") ?? [];

  // Extract crystal palette from the active poster's color data
  const crystalPalette: CrystalColor[] =
    (poster?.colorPalette as ColorPalette | null)?.crystal ?? [];

  // Collect external links from all editions
  const externalLinks: {
    label: string;
    href: string;
  }[] = [];
  for (const edition of work.editions) {
    if (edition.googleBooksId) {
      externalLinks.push({
        label: "Google Books",
        href: `https://books.google.com/books?id=${edition.googleBooksId}`,
      });
    }
    if (edition.openLibraryKey) {
      externalLinks.push({
        label: "Open Library",
        href: `https://openlibrary.org${edition.openLibraryKey}`,
      });
    }
    if (edition.goodreadsId) {
      externalLinks.push({
        label: "Goodreads",
        href: `https://www.goodreads.com/book/show/${edition.goodreadsId}`,
      });
    }
  }

  // Deduplicate by href
  const uniqueExternalLinks = externalLinks.filter(
    (link, idx, arr) => arr.findIndex((l) => l.href === link.href) === idx,
  );

  const backgroundUrl = background
    ? `/api/s3/read?key=${encodeURIComponent(background.s3Key)}`
    : null;

  const page = (
    <div className="relative">
      <CopyShortcuts
        name={formatBookClipboardText(work.title, primaryAuthors.map((a) => a.name))}
        title={work.title}
        // The first edition shown that has an ISBN, its ISBN-13 if it has one
        isbn={work.editions.map((e) => e.isbn13 ?? e.isbn10).find(Boolean)}
      />
      {/* Ambient color field — independent layer, spans from top of page
            down ~600px, sits behind all content. NOT inside the hero. */}
      {crystalPalette.length > 0 && (
        <AmbientCrystals palette={crystalPalette} />
      )}

      {/* Cinematic backdrop + header */}
      <div
        className={
          background ? "relative z-[1] -mx-4 -mt-6 mb-8 md:-mx-6" : "relative z-[1] mb-8"
        }
      >
        {/* Background image layer */}
        {background && (
          <div className="absolute inset-0 -z-0 overflow-hidden">
            <img
              src={backgroundUrl!}
              alt=""
              className="h-full w-full object-cover"
              style={mediaImageStyle(mediaCrop(background))}
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
          </div>
        )}

        {/* Content on top of the backdrop */}
        <div className={background ? "relative z-10 px-4 pt-6 pb-2 md:px-6" : ""}>
          {/* Back link */}
          <Link
            href="/library"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
            Back to books
          </Link>

          {/* Header */}
          <div className={`${background ? "mb-4" : "mb-8"} flex flex-col gap-6 sm:flex-row`}>
            {/* Poster image */}
            {poster && (
              <WorkPosterImage
                src={`/api/s3/read?key=${encodeURIComponent(poster.s3Key)}`}
                alt={`${work.title} poster`}
                crop={mediaCrop(poster)}
                palette={crystalPalette}
              />
            )}

            <div className="min-w-0 flex-1">
              {/* On a phone the actions wrap below a long title */}
              <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
                <h1 className="type-page-title min-w-0 break-words">
                  {work.title}
                </h1>
                {/* On the cap-height center of the title's first line */}
                <CapAlignedControls height={32} className="type-page-title">
                  <FavouriteToggle
                    favourite={work.isFavourite}
                    target={{ entity: "work", id: work.id }}
                    name={work.title}
                    shortcut
                  />
                  <CollectionButton workId={work.id} title={work.title} />
                  <CopyBookButton
                    title={work.title}
                    authorNames={primaryAuthors.map((a) => a.name)}
                  />
                  <WorkActionsMenu
                    work={{
                      id: work.id,
                      slug: work.slug ?? "",
                      title: work.title,
                      originalLanguage: work.originalLanguage,
                      originalYear: work.originalYear ?? null,
                      description: work.description ?? null,
                      seriesName: work.seriesName ?? null,
                      seriesPosition: work.seriesPosition ?? null,
                      seriesId: work.seriesId ?? null,
                      isAnthology: work.isAnthology,
                      workTypeId: work.workTypeId ?? null,
                      notes: work.notes ?? null,
                      rating: work.rating ?? null,
                      catalogueStatus: work.catalogueStatus,
                      acquisitionPriority: work.acquisitionPriority,
                      goodreadsUrl: work.goodreadsUrl ?? null,
                      storygraphUrl: work.storygraphUrl ?? null,
                      recommenderIds: work.workRecommenders.map(
                        (wr) => wr.recommender.id,
                      ),
                    }}
                    workAuthors={work.workAuthors.map((wa) => ({
                      id: wa.author.id,
                      name: wa.author.name,
                      role: wa.role,
                    }))}
                    authorName={primaryAuthors.map((a) => a.name).join(", ")}
                    readingCounts={readingCounts}
                    editionCount={work.editions.length}
                    instanceCount={work.editions.reduce(
                      (acc, e) => acc + (e.instances?.length ?? 0),
                      0,
                    )}
                    posterCount={allPosters.length}
                    backgroundCount={allBackgrounds.length}
                    galleryCount={galleryMedia.length}
                    taxonomyIds={{
                      subjectIds: work.workSubjects.map((ws) => ws.subject.id),
                      categoryIds: work.workCategories.map(
                        (wc) => wc.category.id,
                      ),
                      themeIds: work.workThemes.map((wt) => wt.theme.id),
                      literaryMovementIds: work.workLiteraryMovements.map(
                        (wlm) => wlm.literaryMovement.id,
                      ),
                      artTypeIds: work.workArtTypes.map(
                        (wat) => wat.artType.id,
                      ),
                      artMovementIds: work.workArtMovements.map(
                        (wam) => wam.artMovement.id,
                      ),
                      keywordIds: work.workKeywords.map((wk) => wk.keyword.id),
                      attributeIds: work.workAttributes.map(
                        (wa) => wa.attribute.id,
                      ),
                    }}
                    availableSeries={allSeries.map((s) => ({
                      id: s.id,
                      title: s.title,
                    }))}
                    availableWorkTypes={allWorkTypes.map((wt) => ({
                      id: wt.id,
                      name: wt.name,
                    }))}
                    availableRecommenders={allRecommenders.map((r) => ({
                      id: r.id,
                      name: r.name,
                    }))}
                    availableGenres={allGenres.map((g) => ({
                      id: g.id,
                      name: g.name,
                    }))}
                    availableTags={allTags.map((t) => ({
                      id: t.id,
                      name: t.name,
                    }))}
                    taxonomyOptions={{
                      subjects: allSubjects.map((s) => ({
                        id: s.id,
                        name: s.name,
                      })),
                      categories: allCategories.map((c) => ({
                        id: c.id,
                        name: c.name,
                      })),
                      themes: allThemes.map((t) => ({
                        id: t.id,
                        name: t.name,
                      })),
                      literaryMovements: allLiteraryMovements.map((lm) => ({
                        id: lm.id,
                        name: lm.name,
                      })),
                      artTypes: allArtTypes.map((at) => ({
                        id: at.id,
                        name: at.name,
                      })),
                      artMovements: allArtMovements.map((am) => ({
                        id: am.id,
                        name: am.name,
                      })),
                      keywords: allKeywords.map((k) => ({
                        id: k.id,
                        name: k.name,
                      })),
                      attributes: allAttributes.map((a) => ({
                        id: a.id,
                        name: a.name,
                      })),
                    }}
                  />
                </CapAlignedControls>
              </div>

              {/* Author links */}
              {primaryAuthors.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {primaryAuthors.map((author, i) => (
                    <span key={author.id} className="text-sm text-fg-secondary">
                      {i > 0 && <span className="mr-1 text-fg-secondary">,</span>}
                      {author.slug ? (
                        <Link
                          href={`/people/${author.slug}`}
                          className="transition-colors hover:text-accent-rose-text"
                        >
                          {author.name}
                        </Link>
                      ) : (
                        author.name
                      )}
                    </span>
                  ))}
                </div>
              )}

              {/* Year and rating. The row carries the year's type: icons
                  and buttons sit on its cap-height center */}
              {/* py-1: the 28px buttons fit in the row, which keeps its height */}
              <div className="mt-2 flex flex-wrap items-start gap-3 py-1 font-mono text-xs">
                {work.originalYear && (
                  <span className="text-fg-secondary">{work.originalYear}</span>
                )}
                {work.rating != null && (
                  <div className="flex items-start gap-1.5">
                    <CapAligned height={14}>
                      <RatingStars value={work.rating} size={14} />
                    </CapAligned>
                    <span className="text-accent-gold" aria-hidden="true">
                      {formatRating(work.rating)}
                    </span>
                  </div>
                )}
                {/* Marks: one group; the negative margin cancels the
                    buttons' padding so every icon sits 12px from its neighbour */}
                <CapAligned height={28}>
                  <div
                    role="group"
                    aria-label={MARKS_LABEL}
                    className="-mx-1.5 flex items-center"
                  >
                    <HuntAssessmentControl
                      workId={work.id}
                      isRare={work.isRare}
                      huntAssessedOn={work.huntAssessedOn}
                    />
                    <PoisonToggle workId={work.id} isPoison={work.isPoison} />
                  </div>
                </CapAligned>
                <BookLinks
                  goodreadsUrl={work.goodreadsUrl}
                  storygraphUrl={work.storygraphUrl}
                />
                {work.workType && (
                  <Badge variant="muted">{work.workType.name}</Badge>
                )}
              </div>

              {/* The reading control, and the Read button for digital editions */}
              {(canRead || digitalBooks.length > 0) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canRead && <ReadingControl />}
                  {digitalBooks.length > 0 && <ReadButton calibreBooks={digitalBooks} />}
                </div>
              )}
              {prediction && (
                <div className="mt-2 flex items-start gap-1 text-xs text-fg-secondary" data-book-prediction="">
                  <span>{prediction.text}</span>
                  <CapAligned height={24}>
                    <EstimateInfo text={prediction.why} label="How this rating is predicted" />
                  </CapAligned>
                </div>
              )}

              {/* Status badges */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="muted">{languageName(work.originalLanguage)}</Badge>
                {work.isAnthology && <Badge variant="blue">Anthology</Badge>}
                <Badge variant={catalogueStatusVariant(work.catalogueStatus)}>
                  {catalogueStatusLabel(work.catalogueStatus)}
                </Badge>
                {work.acquisitionPriority &&
                  work.acquisitionPriority !== "none" && (
                    <Badge variant={priorityVariant(work.acquisitionPriority)}>
                      {priorityLabel(work.acquisitionPriority)} priority
                    </Badge>
                  )}
              </div>

              {/* Recommended by */}
              {work.workRecommenders.length > 0 && (
                <div className="mt-3">
                  <span className="text-xs text-fg-secondary">Recommended by </span>
                  {work.workRecommenders.map((wr, i) => (
                    <span key={wr.recommender.id}>
                      {i > 0 && (
                        <span className="text-xs text-fg-secondary">, </span>
                      )}
                      <Link
                        href={`/recommenders/${wr.recommender.id}`}
                        className="text-xs text-accent-rose-text transition-colors hover:text-fg-primary"
                      >
                        {wr.recommender.name}
                      </Link>
                      {wr.recommender.url && (
                        <a
                          href={wr.recommender.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${wr.recommender.name} website`}
                          data-tooltip={`${wr.recommender.name} website`}
                          // In running text: the CapAligned box on the link
                          // itself, sized by the name's type (text-xs), so
                          // the icon sits on the name's cap-height center
                          className="ml-1 inline-block overflow-hidden align-[0.5cap] text-xs text-fg-muted transition-colors hover:text-accent-rose"
                          style={{ height: 12, marginBlock: -6 }}
                        >
                          <ExternalLink className="block h-3 w-3" strokeWidth={1.5} />
                        </a>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* end content-on-backdrop */}
      </div>
      {/* end cinematic backdrop */}

      {/* Reading column and, from lg up, the record on the right */}
      <DetailColumns
        record={
          <WorkRecord
            work={work}
            orders={workOrders}
            media={{
              posters: allPosters.length,
              backgrounds: allBackgrounds.length,
              gallery: galleryMedia.length,
            }}
            links={uniqueExternalLinks}
            reading={readingRows.length ? readingRecord(readingRows) : null}
          />
        }
      >
        {work.description && (
          <section className="mb-8">
            <Prose html={sanitizeDescriptionHtml(work.description)} />
          </section>
        )}

        {work.notes && (
          <section className="mb-8">
            <SectionHeading title="Notes" />
            <p className="max-w-2xl whitespace-pre-wrap text-sm text-fg-secondary">
              {work.notes}
            </p>
          </section>
        )}

        {canRead && <ReadingSection />}

        {canRead && readingNotes.length > 0 && (
          <NotesSection notes={readingNotes.map(slimNote)} book={{ title: work.title, author: primaryAuthor?.name ?? null }} />
        )}

        {(acquisitionTargets.length > 0 ||
          HUNTED_STATUSES.has(work.catalogueStatus)) && (
          <AcquisitionTargets
            workId={work.id}
            targets={acquisitionTargets}
            editions={work.editions}
          />
        )}

        <section className="mb-8">
          <SectionHeading
            title="Editions"
            count={work.editions.length}
            action={
              <EditionAddDialog
              workId={work.id}
              workTitle={work.title}
              availableGenres={allGenres.map((g) => ({ id: g.id, name: g.name }))}
              availableTags={allTags.map((t) => ({ id: t.id, name: t.name }))}
            />
            }
          />

          <div className="space-y-4">
            {work.editions.map((edition) => (
              <EditionDetailCard
                key={edition.id}
                edition={edition}
                poster={poster}
                workId={work.id}
                authorName={primaryAuthor?.name}
                availableLocations={allLocations}
                availableGenres={allGenres.map((g) => ({
                  id: g.id,
                  name: g.name,
                }))}
                availableTags={allTags.map((t) => ({ id: t.id, name: t.name }))}
              />
            ))}
          </div>
        </section>

        {/* Recorded links only; "Link a work" is in the actions menu */}
        <LinkedWorksSection
          work={{ id: work.id, kind: "book", title: work.title }}
          relations={links}
          showEmpty={false}
        />
      </DetailColumns>

      {/* Gallery collage */}
      <GallerySection entityType="work" entityId={work.id} />

      {work.series && seriesWorks.length > 0 && (
        <section className="mb-8" aria-label="More in this series">
          <WorkCarousel
            title={`More in ${work.series.title}`}
            titleHref={`/series/${work.series.id}`}
            works={seriesWorks}
            caption={(w) => (
              <p className="mt-1.5 lines-1 text-micro text-fg-secondary">
                {w.seriesPosition
                  ? `Volume ${w.seriesPosition}`
                  : "Position not set"}
              </p>
            )}
          />
        </section>
      )}

      {/* Works by same author */}
      {relatedWorks.length > 0 && primaryAuthor && (
        <section className="mb-8">
          <WorkCarousel
            title={`More by ${primaryAuthor.name}`}
            titleHref={
              primaryAuthor.slug ? `/people/${primaryAuthor.slug}` : undefined
            }
            works={relatedWorks}
          />
        </section>
      )}

      {/* Collections holding this book */}
      {workCollections.length > 0 && (
        <section className="mb-8">
          <HorizontalCarousel title="Collections" titleHref="/collections">
            {workCollections.map((collection) => (
              <div
                key={collection.id}
                className="w-[160px] flex-shrink-0 snap-start"
              >
                <CollectionCard
                  collection={collection}
                  covers={collectionCovers
                    .filter((p) => p.collectionId === collection.id)
                    .map((p) => p.s3Key)}
                  footer={
                    work.editions.length > 1
                      ? collection.heldEditions
                          .map((e) =>
                            [e.editionTitle, e.publicationYear]
                              .filter(Boolean)
                              .join(", "),
                          )
                          .join(" · ")
                      : undefined
                  }
                />
              </div>
            ))}
          </HorizontalCarousel>
        </section>
      )}

      {/* Other books in this book's collections, most similar first */}
      {similarWorks.length > 0 && (
        <section className="mb-8">
          <WorkCarousel
            title={
              workCollections.length === 1
                ? `More in ${workCollections[0].name}`
                : "More from these collections"
            }
            titleHref={
              workCollections.length === 1
                ? `/collections/${workCollections[0].id}`
                : undefined
            }
            works={similarWorks}
            caption={
              workCollections.length > 1
                ? (w) => (
                    <p className="mt-1.5 lines-2 text-micro text-fg-secondary">
                      {w.reasons.map((r) => r.name).join(" · ")}
                    </p>
                  )
                : undefined
            }
          />
        </section>
      )}

      {/* Other books with each of this book's marks: "Other Rarities" */}
      {markRows
        .filter((row) => row.works.length > 0)
        .map(({ mark, works: marked }) => (
          <section key={mark.key} className="mb-8">
            <WorkCarousel
              title={otherMarkedTitle(mark)}
              titleHref={`/library?mark=${mark.key}`}
              works={marked}
            />
          </section>
        ))}

      {/* Activity timeline */}
      <ActivityTimeline entityType="work" entityId={work.id} />

    </div>
  );
  const openReading = readingRows.find((r) => r.reading.status === "reading" || r.reading.status === "paused");
  return canRead ? (
    <ReadingProvider data={readingData}>
      {page}
      {then && (
        <ReadingThen
          workId={work.id}
          then={then}
          openReading={openReading ? { workId: work.id, readingId: openReading.reading.id, fingerprint: openReading.fingerprint } : null}
        />
      )}
    </ReadingProvider>
  ) : (
    page
  );
}
