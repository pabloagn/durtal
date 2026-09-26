import { paginateItems, type ListSearchParams } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Tag } from "lucide-react";
import { db } from "@/lib/db";
import { works, workAuthors } from "@/lib/db/schema";
import { inArray, asc } from "drizzle-orm";
import {
  getTaxonomyFamily,
  getTaxonomyItem,
} from "@/lib/actions/taxonomy-families";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { BookCard } from "@/components/books/book-card";
import { mediaCrop } from "@/lib/utils/media-style";

// ── Helpers ────────────────────────────────────────────────────────────────

function getImageUrl(s3Key: string) {
  return `/api/s3/read?key=${encodeURIComponent(s3Key)}`;
}

// ── Data fetcher for works by IDs ──────────────────────────────────────────

async function getWorksByIds(ids: string[]) {
  if (ids.length === 0) return [];

  const results = await db.query.works.findMany({
    where: inArray(works.id, ids),
    orderBy: asc(works.title),
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
      },
    },
  });

  return results;
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
    getTaxonomyFamily(familySlug),
    getTaxonomyItem(familySlug, itemSlug),
  ]);

  if (!family || !item) notFound();

  // Fetch associated works
  const entityIds = item.entityIds ?? [];
  const entityWorks =
    family.entityLevel === "work" ? await getWorksByIds(entityIds) : [];

  const paging = paginateItems(entityWorks, searchParams);

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-fg-muted">
        <Link
          href="/taxonomy"
          className="transition-colors hover:text-fg-secondary"
        >
          Taxonomy
        </Link>
        <span>/</span>
        <Link
          href={`/taxonomy/${family.slug}`}
          className="transition-colors hover:text-fg-secondary"
        >
          {family.name}
        </Link>
        <span>/</span>
        <span className="text-fg-secondary">{item.name}</span>
      </nav>

      {/* Item header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          {item.color && (
            <span
              className="block h-3.5 w-3.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
          )}
          <h1 className="font-serif text-4xl tracking-tight text-fg-primary">
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
            <span className="font-mono text-micro text-fg-muted">
              Created{" "}
              {new Date(item.createdAt as string | Date).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Entity grid */}
      {family.entityLevel === "work" && entityWorks.length > 0 && (
        <div>
          <h2 className="mb-4 font-serif text-xl text-fg-primary">
            Associated Works
          </h2>
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
              const coverUrl = coverKey ? getImageUrl(coverKey) : null;

              const coverCrop = poster ? mediaCrop(poster) : null;

              const instanceCount = work.editions?.reduce(
                (sum, ed) => sum + (ed.instances?.length ?? 0),
                0,
              ) ?? 0;

              return (
                <BookCard
                  key={work.id}
                  workId={work.id}
                  slug={work.slug ?? work.id}
                  title={work.title}
                  authorName={authorName}
                  authorNames={work.workAuthors.map((wa) => wa.author.name)}
                  coverUrl={coverUrl}
                  coverCrop={coverCrop}
                  publicationYear={primaryEdition?.publicationYear}
                  language={primaryEdition?.language}
                  instanceCount={instanceCount}
                  rating={work.rating}
                  catalogueStatus={work.catalogueStatus}
                  acquisitionPriority={work.acquisitionPriority}
                  primaryEditionId={primaryEdition?.id}
                />
              );
            })}
          </div>
          </PaginatedSection>
        </div>
      )}

      {family.entityLevel === "edition" && entityIds.length > 0 && (
        <div>
          <h2 className="mb-4 font-serif text-xl text-fg-primary">
            Associated Editions
          </h2>
          <p className="text-sm text-fg-muted">
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
