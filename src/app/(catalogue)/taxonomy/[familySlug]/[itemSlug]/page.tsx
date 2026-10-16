import type { Metadata } from "next";
import { catalogueAvailability } from "@/lib/ebooks/catalogue-availability";
import { pageHref } from "@/lib/utils/pagination";
import { compareWorks } from "@/lib/utils/title-order";
import { paginateItems, type ListSearchParams } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadFamily, loadItem } from "../load";
import Link from "next/link";
import { Tag } from "lucide-react";
import { db } from "@/lib/db";
import { works, workAuthors } from "@/lib/db/schema";
import { inArray, asc } from "drizzle-orm";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { BookCard } from "@/components/books/book-card";
import { mediaCrop } from "@/lib/utils/media-style";
import { SectionHeading } from "@/components/shared/section-heading";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { CapAligned } from "@/components/shared/cap-aligned";
import { titleLength } from "@/components/shared/detail-layout";
import { posterTone, workCardExtras } from "@/lib/actions/utils/work-card-query";
import { cardReadingOf } from "@/lib/reading/card";
import { mediaUrl } from "@/lib/s3/media-url";

// ── Helpers ────────────────────────────────────────────────────────────────

// ── Data fetcher for works by IDs ──────────────────────────────────────────

async function getWorksByIds(ids: string[]) {
  if (ids.length === 0) return [];

  const results = await db.query.works.findMany({
    where: inArray(works.id, ids),
    orderBy: asc(works.title),
    // An open reading on the card (SLN-449)
    extras: workCardExtras,
    with: {
      workAuthors: {
        with: { author: true },
        orderBy: asc(workAuthors.sortOrder),
      },
      editions: {
        columns: {
          id: true,
          coverS3Key: true,
          thumbnailS3Key: true,
          publicationYear: true,
          language: true,
        },
        with: {
          instances: {
            columns: { id: true },
          },
        },
      },
      media: {
        columns: {
          s3Key: true,
          thumbnailS3Key: true,
          type: true,
          isActive: true,
          cropX: true,
          cropY: true,
          cropZoom: true,
          brightness: true,
          contrast: true,
        },
        extras: posterTone,
      },
    },
  });

  return results.sort(compareWorks);
}

/**
 * A collection's list filtered by one item (SLN-886): every key below feeds
 * the list's taxonomy filter, named for the item's family so its chip shows
 */
const FILTER_KEYS: Record<string, string> = {
  "perfume-accords": "accord",
  "perfume-notes": "note",
  "painting-techniques": "technique",
  "painting-media": "medium",
  "painting-supports": "support",
};
const DEFAULT_KEYS: Partial<Record<WorkKind, string>> = { perfume: "family", film: "genre", painting: "genre" };
function filteredListHref(kind: WorkKind, familySlug: string, itemId: string) {
  const key = FILTER_KEYS[familySlug] ?? DEFAULT_KEYS[kind] ?? "genre";
  return `${WORK_DOMAINS[kind].basePath}?${key}=${itemId}`;
}

// ── Content component ──────────────────────────────────────────────────────

async function ItemContent({
  familySlug,
  itemSlug,
  searchParams,
}: {
  familySlug: string;
  itemSlug: string;
  searchParams: ListSearchParams;
}) {
  const [family, item] = await Promise.all([
    loadFamily(familySlug),
    loadItem(familySlug, itemSlug),
  ]);

  if (!family || !item) notFound();

  // Fetch associated works
  const entityIds = item.entityIds ?? [];
  // Books show here as cards; a family of other collections (a perfume
  // note, a film genre) links to each collection's list filtered by the item
  const books = item.kinds[0] === "book";
  const entityWorks =
    family.entityLevel === "work" && books ? await getWorksByIds(entityIds) : [];

  const paging = paginateItems(entityWorks, searchParams);
  const digital = await catalogueAvailability(paging.items.map((work) => work.id));
  const readerReturnTo = pageHref(`/taxonomy/${familySlug}/${itemSlug}`, searchParams, paging.page);

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex flex-wrap items-center gap-1.5 text-sm text-fg-secondary">
        <Link
          href="/taxonomy"
          className="transition-colors hover:text-fg-secondary min-w-0 break-words pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center"
        >
          Taxonomy
        </Link>
        <span>/</span>
        <Link
          href={`/taxonomy/${family.slug}`}
          className="transition-colors hover:text-fg-secondary min-w-0 break-words pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center"
        >
          {family.name}
        </Link>
        <span>/</span>
        <span className="min-w-0 break-words text-fg-secondary">{item.name}</span>
      </nav>

      {/* Item header */}
      <div className="mb-8">
        {/* The name steps down on a phone like every record title, its
            colour on the first line's cap height (SLN-877) */}
        <div data-title-length={titleLength(item.name)} className="type-page-title flex items-start gap-3">
          {item.color && (
            <CapAligned height={14}>
              <span
                className="block h-3.5 w-3.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
            </CapAligned>
          )}
          <h1 data-title-length={titleLength(item.name)} className="type-page-title min-w-0 [overflow-wrap:anywhere]">
            {item.name}
          </h1>
        </div>
        {"description" in item && item.description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-secondary">
            {item.description as string}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <Badge variant="muted">
            {entityIds.length} {family.entityLevel}
            {entityIds.length === 1 ? "" : "s"}
          </Badge>
          {"createdAt" in item && item.createdAt && (
            <span className="font-mono text-micro text-fg-secondary">
              Created{" "}
              {new Date(item.createdAt as string | Date).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Entity grid */}
      {family.entityLevel === "work" && entityWorks.length > 0 && (
        <div>
          <SectionHeading title="Associated works" />
          <PaginatedSection {...paging} noun="works">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {paging.items.map((work) => {
              const authorName = work.workAuthors
                .map((wa) => wa.author?.name ?? "Unknown")
                .join(", ");

              // Find active poster media
              const poster = work.media?.find(
                (m) => m.type === "poster" && m.isActive,
              );
              const posterKey = poster?.thumbnailS3Key ?? poster?.s3Key;

              // Fallback to edition cover
              const primaryEdition = work.editions?.[0];
              const coverKey =
                posterKey ??
                primaryEdition?.thumbnailS3Key ??
                primaryEdition?.coverS3Key;
              const coverUrl = coverKey ? mediaUrl(coverKey) : null;

              const coverCrop = poster ? mediaCrop(poster) : null;

              const instanceCount = work.editions?.reduce(
                (sum, ed) => sum + (ed.instances?.length ?? 0),
                0,
              ) ?? 0;

              return (
                <BookCard
                  key={work.id}
                  workId={work.id}
                  ebook={digital.get(work.id)?.read ?? null}
                  readerReturnTo={readerReturnTo}
                  slug={work.slug ?? work.id}
                  title={work.title}
                  authorName={authorName}
                  authorNames={work.workAuthors.map((wa) => wa.author.name)}
                  coverUrl={coverUrl}
                  coverCrop={coverCrop}
                  coverTone={poster?.tone ?? null}
                  publicationYear={primaryEdition?.publicationYear}
                  language={primaryEdition?.language}
                  instanceCount={instanceCount}
                  rating={work.rating}
                  catalogueStatus={work.catalogueStatus}
                  acquisitionPriority={work.acquisitionPriority}
                  isRare={work.isRare}
                  huntAssessedOn={work.huntAssessedOn}
                  isPoison={work.isPoison}
                  isFavourite={work.isFavourite}
                  primaryEditionId={primaryEdition?.id}
                  reading={cardReadingOf(work)}
                />
              );
            })}
          </div>
          </PaginatedSection>
        </div>
      )}

      {family.entityLevel === "work" && !books && entityIds.length > 0 && (
        <div>
          <SectionHeading title="Associated works" />
          <ul className="space-y-2 text-sm" data-item-kinds="">
            {item.kindCounts
              .filter(({ count }) => count > 0)
              .map(({ kind, count }) => (
                <li key={kind}>
                  <Link href={filteredListHref(kind, family.slug, item.id)} className="text-command touch-hit">
                    {count.toLocaleString("en-US")}{" "}
                    {(count === 1 ? WORK_DOMAINS[kind].label : WORK_DOMAINS[kind].pluralLabel).toLowerCase()}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      )}

      {family.entityLevel === "edition" && entityIds.length > 0 && (
        <div>
          <SectionHeading title="Associated editions" />
          <p className="text-sm text-fg-secondary">
            {entityIds.length} edition{entityIds.length === 1 ? "" : "s"}{" "}
            linked to this item.
          </p>
        </div>
      )}

      {entityIds.length === 0 && (
        <EmptyState
          icon={Tag}
          title="No associated entities"
          description={`No ${family.entityLevel}s are linked to this item yet`}
        />
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ familySlug: string; itemSlug: string }>;
}): Promise<Metadata> {
  const { familySlug, itemSlug } = await params;
  const [family, item] = await Promise.all([
    loadFamily(familySlug),
    loadItem(familySlug, itemSlug),
  ]);
  return { title: family && item ? `${item.name} · ${family.name}` : "Taxonomy not found" };
}

export default async function TaxonomyItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ familySlug: string; itemSlug: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { familySlug, itemSlug } = await params;
  const query = await searchParams;

  return (
    <Suspense key={JSON.stringify(query)}
      fallback={
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      }
    >
      <ItemContent familySlug={familySlug} itemSlug={itemSlug} searchParams={query} />
    </Suspense>
  );
}
