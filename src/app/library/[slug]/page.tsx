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
import { ArrowLeft, Star, Route, ExternalLink } from "lucide-react";
import {
  getWorkBySlug,
  getWorksByAuthorId,
  getWorksWithMark,
} from "@/lib/actions/works";
import { MARKS_LABEL, marksOf, otherMarkedTitle } from "@/lib/constants/marks";
import { getAuthors } from "@/lib/actions/authors";
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
import { WorkMediaInline } from "./work-media-inline";
import { WorkMetadataGrid } from "./work-metadata-grid";
import { WorkTaxonomySection } from "./work-taxonomy-section";
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

interface PageProps {
  params: Promise<{ slug: string }>;
}

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

export default async function WorkDetailPage({ params }: PageProps) {
  const { slug } = await params;

  const [
    work,
    allAuthors,
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
    getWorkBySlug(slug),
    getAuthors({ limit: 1000 }),
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
  ]);
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

  return (
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
          background ? "relative z-[1] -mx-6 -mt-6 mb-8" : "relative z-[1] mb-8"
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
        <div className={background ? "relative z-10 px-6 pt-6 pb-2" : ""}>
          {/* Back link */}
          <Link
            href="/library"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
            Back to books
          </Link>

          {/* Header */}
          <div className={`${background ? "mb-4" : "mb-8"} flex gap-6`}>
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
              <div className="flex items-start justify-between gap-3">
                <h1 className="type-page-title">
                  {work.title}
                </h1>
                <div className="flex shrink-0 items-center gap-2">
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
                    availableAuthors={allAuthors.map((a) => ({
                      id: a.id,
                      name: a.name,
                    }))}
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
                </div>
              </div>

              {/* Author links */}
              {primaryAuthors.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {primaryAuthors.map((author, i) => (
                    <span key={author.id} className="text-sm text-fg-secondary">
                      {i > 0 && <span className="mr-1 text-fg-secondary">,</span>}
                      {author.slug ? (
                        <Link
                          href={`/authors/${author.slug}`}
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

              {/* Year and rating */}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {work.originalYear && (
                  <span className="font-mono text-xs text-fg-secondary">
                    {work.originalYear}
                  </span>
                )}
                {work.rating && (
                  <div className="flex items-center gap-1">
                    <Star
                      className="h-3 w-3 text-accent-gold"
                      strokeWidth={1.5}
                      fill="currentColor"
                    />
                    <span className="font-mono text-xs text-accent-gold">
                      {work.rating}/5
                    </span>
                  </div>
                )}
                {/* Marks: one group; the negative margin cancels the
                    buttons' padding so every icon sits 12px from its neighbour */}
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
                <BookLinks
                  goodreadsUrl={work.goodreadsUrl}
                  storygraphUrl={work.storygraphUrl}
                />
                {work.workType && (
                  <Badge variant="muted">{work.workType.name}</Badge>
                )}
              </div>

              {/* Read button (digital editions) */}
              {digitalBooks.length > 0 && (
                <div className="mt-3">
                  <ReadButton calibreBooks={digitalBooks} />
                </div>
              )}

              {/* Status badges */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="muted">{work.originalLanguage}</Badge>
                {work.isAnthology && <Badge variant="blue">Anthology</Badge>}
                <Badge variant={catalogueStatusVariant(work.catalogueStatus)}>
                  {work.catalogueStatus}
                </Badge>
                {work.acquisitionPriority &&
                  work.acquisitionPriority !== "none" && (
                    <Badge variant={priorityVariant(work.acquisitionPriority)}>
                      {work.acquisitionPriority} priority
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
                          title={`${wr.recommender.name} website`}
                          className="ml-1 inline-flex align-middle text-fg-muted transition-colors hover:text-accent-rose"
                        >
                          <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
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

      {/* Description */}
      {work.description && (
        <section className="mb-8">
          <div
            className="prose-description max-w-2xl text-sm leading-relaxed text-fg-secondary [&_p]:mb-2 [&_p:last-child]:mb-0 [&_a]:text-accent-rose [&_a:hover]:underline"
            dangerouslySetInnerHTML={{
              __html: sanitizeDescriptionHtml(work.description),
            }}
          />
        </section>
      )}

      {/* Metadata grid */}
      <WorkMetadataGrid work={work} />

      {/* Taxonomy section */}
      <WorkTaxonomySection work={work} />

      {/* Media management */}
      <WorkMediaInline
        workId={work.id}
        title={work.title}
        posterCount={allPosters.length}
        backgroundCount={allBackgrounds.length}
        galleryCount={galleryMedia.length}
        showButton={false}
      />

      {/* Gallery collage */}
      <GallerySection entityType="work" entityId={work.id} />

      <AcquisitionTargets
        workId={work.id}
        targets={acquisitionTargets}
        editions={work.editions}
      />

      {/* Editions */}
      <section className="mb-8">
        <SectionHeading
          title="Editions"
          count={work.editions.length}
          action={
            <EditionAddDialog
            workId={work.id}
            workTitle={work.title}
            availableAuthors={allAuthors.map((a) => ({
              id: a.id,
              name: a.name,
            }))}
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
              availableAuthors={allAuthors.map((a) => ({
                id: a.id,
                name: a.name,
              }))}
              availableGenres={allGenres.map((g) => ({
                id: g.id,
                name: g.name,
              }))}
              availableTags={allTags.map((t) => ({ id: t.id, name: t.name }))}
            />
          ))}
        </div>
      </section>

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
              primaryAuthor.slug ? `/authors/${primaryAuthor.slug}` : undefined
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

      {/* Orders */}
      {workOrders.length > 0 && (
        <section className="mb-8">
          <SectionHeading
            title="Orders"
            count={workOrders.length}
            action={
              <Link
              href="/provenance"
              className="inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
            >
              <Route className="h-3 w-3" strokeWidth={1.5} />
              View pipeline
            </Link>
            }
          />
          <div className="space-y-2">
            {workOrders.map((order) => {
              const statusVariantMap: Record<
                string,
                "default" | "blue" | "gold" | "sage" | "red" | "muted"
              > = {
                placed: "muted",
                confirmed: "blue",
                processing: "gold",
                shipped: "sage",
                in_transit: "sage",
                out_for_delivery: "gold",
                delivered: "sage",
                purchased: "sage",
                received: "sage",
                bid: "gold",
                won: "sage",
                cancelled: "red",
                returned: "red",
              };
              const variant = statusVariantMap[order.status] ?? "muted";
              return (
                <div
                  key={order.id}
                  className="flex items-center gap-3 rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5"
                >
                  <Badge variant={variant}>
                    {order.status.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-xs text-fg-secondary">
                    {order.acquisitionMethod.replace(/_/g, " ")}
                  </span>
                  {order.venue && (
                    <span className="truncate text-xs text-fg-secondary">
                      {order.venue.name}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-micro text-fg-secondary">
                    {new Date(order.orderDate).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Activity timeline */}
      <ActivityTimeline entityType="work" entityId={work.id} />

      {/* Notes */}
      {work.notes && (
        <section className="mb-8">
          <SectionHeading title="Notes" />
          <p className="max-w-2xl whitespace-pre-wrap text-sm text-fg-secondary">
            {work.notes}
          </p>
        </section>
      )}

      {/* External links */}
      {(uniqueExternalLinks.length > 0 || work.metadataSource) && (
        <section className="mb-8">
          <SectionHeading title="External Links" />
          <div className="flex flex-wrap gap-4">
            {work.metadataSource && (
              <span className="text-xs text-fg-secondary">
                Metadata:{" "}
                <span className="text-fg-secondary">{work.metadataSource}</span>
                {work.metadataSourceId && (
                  <span className="ml-1 font-mono text-fg-secondary">
                    ({work.metadataSourceId})
                  </span>
                )}
              </span>
            )}
            {uniqueExternalLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-fg-secondary transition-colors hover:text-accent-rose-text"
              >
                {link.label}
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
