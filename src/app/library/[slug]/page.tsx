export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Star } from "lucide-react";
import { getWorkBySlug } from "@/lib/actions/works";
import { getAuthors } from "@/lib/actions/authors";
import { getSeries } from "@/lib/actions/series";
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
import { Badge } from "@/components/ui/badge";
import { WorkMediaSection } from "./work-media-section";
import { WorkMetadataGrid } from "./work-metadata-grid";
import { WorkTaxonomySection } from "./work-taxonomy-section";
import { EditionDetailCard } from "./edition-detail-card";
import { EditionAddDialog } from "./edition-add-dialog";
import { WorkEditDialog } from "./work-edit-dialog";
import { WorkTaxonomyEditDialog } from "./work-taxonomy-edit-dialog";

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

function acquisitionPriorityVariant(
  priority: string,
): "red" | "gold" | "blue" | "muted" {
  switch (priority) {
    case "urgent":
      return "red";
    case "high":
      return "gold";
    case "medium":
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

  const primaryAuthors = work.workAuthors.map((wa) => wa.author);
  const poster = work.media?.find((m) => m.type === "poster");
  const background = work.media?.find((m) => m.type === "background");
  const galleryMedia = work.media?.filter((m) => m.type === "gallery") ?? [];

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

  return (
    <>
      {/* Back link */}
      <Link
        href="/library"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to library
      </Link>

      {/* Header */}
      <div className="mb-8 flex gap-6">
        {/* Poster image */}
        {poster && (
          <div className="relative h-48 w-32 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
            <img
              src={`/api/s3/read?key=${encodeURIComponent(poster.s3Key)}`}
              alt={`${work.title} poster`}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-serif text-4xl tracking-tight text-fg-primary">
              {work.title}
            </h1>
            <WorkEditDialog
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
                recommenderId: work.recommenderId ?? null,
              }}
              authors={work.workAuthors.map((wa) => ({
                id: wa.author.id,
                name: wa.author.name,
                role: wa.role,
              }))}
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
            />
          </div>

          {/* Author links */}
          {primaryAuthors.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {primaryAuthors.map((author, i) => (
                <span key={author.id} className="text-sm text-fg-secondary">
                  {i > 0 && (
                    <span className="mr-1 text-fg-muted">,</span>
                  )}
                  {author.slug ? (
                    <Link
                      href={`/authors/${author.slug}`}
                      className="transition-colors hover:text-accent-rose"
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
              <span className="font-mono text-xs text-fg-muted">
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
            {work.workType && (
              <Badge variant="muted">{work.workType.name}</Badge>
            )}
          </div>

          {/* Status badges */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="muted">{work.originalLanguage}</Badge>
            {work.isAnthology && (
              <Badge variant="blue">Anthology</Badge>
            )}
            <Badge variant={catalogueStatusVariant(work.catalogueStatus)}>
              {work.catalogueStatus}
            </Badge>
            {work.acquisitionPriority && work.acquisitionPriority !== "none" && (
              <Badge
                variant={acquisitionPriorityVariant(work.acquisitionPriority)}
              >
                {work.acquisitionPriority} priority
              </Badge>
            )}
          </div>

          {/* Recommended by */}
          {work.recommender && (
            <div className="mt-3">
              <span className="text-xs text-fg-muted">Recommended by </span>
              {work.recommender.url ? (
                <a
                  href={work.recommender.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent-rose transition-colors hover:text-fg-primary"
                >
                  {work.recommender.name}
                </a>
              ) : (
                <span className="text-xs text-fg-secondary">
                  {work.recommender.name}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {work.description && (
        <section className="mb-8">
          <p className="max-w-2xl text-sm leading-relaxed text-fg-secondary">
            {work.description}
          </p>
        </section>
      )}

      {/* Metadata grid */}
      <WorkMetadataGrid work={work} />

      {/* Taxonomy section */}
      <WorkTaxonomySection
        work={work}
        headerAction={
          <WorkTaxonomyEditDialog
            workId={work.id}
            currentSubjectIds={work.workSubjects.map((ws) => ws.subject.id)}
            currentCategoryIds={work.workCategories.map((wc) => wc.category.id)}
            currentThemeIds={work.workThemes.map((wt) => wt.theme.id)}
            currentLiteraryMovementIds={work.workLiteraryMovements.map(
              (wlm) => wlm.literaryMovement.id,
            )}
            currentArtTypeIds={work.workArtTypes.map((wat) => wat.artType.id)}
            currentArtMovementIds={work.workArtMovements.map(
              (wam) => wam.artMovement.id,
            )}
            currentKeywordIds={work.workKeywords.map((wk) => wk.keyword.id)}
            currentAttributeIds={work.workAttributes.map(
              (wa) => wa.attribute.id,
            )}
            subjects={allSubjects.map((s) => ({ id: s.id, name: s.name }))}
            categories={allCategories.map((c) => ({ id: c.id, name: c.name }))}
            themes={allThemes.map((t) => ({ id: t.id, name: t.name }))}
            literaryMovements={allLiteraryMovements.map((lm) => ({
              id: lm.id,
              name: lm.name,
            }))}
            artTypes={allArtTypes.map((at) => ({ id: at.id, name: at.name }))}
            artMovements={allArtMovements.map((am) => ({
              id: am.id,
              name: am.name,
            }))}
            keywords={allKeywords.map((k) => ({ id: k.id, name: k.name }))}
            attributes={allAttributes.map((a) => ({ id: a.id, name: a.name }))}
          />
        }
      />

      {/* Media upload and gallery */}
      <WorkMediaSection
        workId={work.id}
        gallery={galleryMedia}
        hasPoster={!!poster}
        hasBackground={!!background}
      />

      {/* Editions */}
      <section className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-2xl text-fg-primary">
            Editions ({work.editions.length})
          </h2>
          <EditionAddDialog
            workId={work.id}
            workTitle={work.title}
            availableAuthors={allAuthors.map((a) => ({ id: a.id, name: a.name }))}
            availableGenres={allGenres.map((g) => ({ id: g.id, name: g.name }))}
            availableTags={allTags.map((t) => ({ id: t.id, name: t.name }))}
          />
        </div>

        <div className="space-y-4">
          {work.editions.map((edition) => (
            <EditionDetailCard
              key={edition.id}
              edition={edition}
              availableLocations={allLocations}
              availableAuthors={allAuthors.map((a) => ({ id: a.id, name: a.name }))}
              availableGenres={allGenres.map((g) => ({ id: g.id, name: g.name }))}
              availableTags={allTags.map((t) => ({ id: t.id, name: t.name }))}
            />
          ))}
        </div>
      </section>

      {/* Notes */}
      {work.notes && (
        <section className="mb-8">
          <h2 className="mb-2 font-serif text-xl text-fg-secondary">Notes</h2>
          <p className="max-w-2xl whitespace-pre-wrap text-sm text-fg-secondary">
            {work.notes}
          </p>
        </section>
      )}

      {/* External links */}
      {(uniqueExternalLinks.length > 0 || work.metadataSource) && (
        <section className="mb-8">
          <h2 className="mb-2 font-serif text-xl text-fg-secondary">
            External Links
          </h2>
          <div className="flex flex-wrap gap-4">
            {work.metadataSource && (
              <span className="text-xs text-fg-muted">
                Metadata:{" "}
                <span className="text-fg-secondary">{work.metadataSource}</span>
                {work.metadataSourceId && (
                  <span className="ml-1 font-mono text-fg-muted">
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
                className="text-xs text-fg-secondary transition-colors hover:text-accent-rose"
              >
                {link.label}
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
