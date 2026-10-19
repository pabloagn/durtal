import type { Metadata } from "next";
import { catalogueAvailability } from "@/lib/ebooks/catalogue-availability";
import { pageHref } from "@/lib/utils/pagination";
import { lastPage, type ListSearchParams } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { loadFamily, loadItem } from "../load";
import Link from "next/link";
import { Tag } from "lucide-react";
import { TaxonomySkeleton } from "@/components/taxonomy/taxonomy-skeleton";
import {
  getTaxonomyBookPage,
  getTaxonomyBookCards,
} from "@/lib/actions/taxonomy-browse";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { BookCard } from "@/components/books/book-card";
import { mediaCrop } from "@/lib/utils/media-style";
import { SectionHeading } from "@/components/shared/section-heading";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { CapAligned } from "@/components/shared/cap-aligned";
import { titleLength } from "@/components/shared/detail-layout";
import { cardReadingOf } from "@/lib/reading/card";
import { mediaUrl } from "@/lib/s3/media-url";

// ── Helpers ────────────────────────────────────────────────────────────────

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
  "art-movements": "movement",
};
const DEFAULT_KEYS: Partial<Record<WorkKind, string>> = {
  perfume: "family",
  film: "genre",
  painting: "genre",
};
/** "films, perfumes and paintings" */
function wordList(words: string[], last: "and" | "or") {
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} ${last} ${words.at(-1)}`
    : (words[0] ?? "");
}

/**
 * Where nothing is tagged yet: what the family tags, in the catalogue's
 * words, and where to tag it (SLN-816, SLN-1157). Book genres and tags are
 * chosen in the edition form; no editor tags an edition with a custom family.
 */
function emptyDescription(
  family: { entityLevel: string; isSystem: boolean },
  kinds: WorkKind[],
  name: string,
) {
  if (family.entityLevel === "edition")
    return family.isSystem
      ? `No book edition is tagged ${name} yet. Choose it under Genres & tags when you edit an edition.`
      : `No book edition is tagged ${name} yet.`;
  const nouns = kinds.map((kind) => WORK_DOMAINS[kind].label.toLowerCase());
  return `No ${wordList(nouns, "or")} is tagged ${name} yet. Tag one from its page.`;
}

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

  const books = item.kinds.includes("book");
  const paging = books
    ? await getTaxonomyBookPage(familySlug, item.id, searchParams)
    : { ids: [], page: 1, perPage: 48, total: 0 };
  const end = lastPage(paging.total, paging.perPage);
  if (paging.page > end)
    redirect(
      pageHref(`/taxonomy/${familySlug}/${itemSlug}`, searchParams, end),
    );
  const [entityWorks, digital] = await Promise.all([
    getTaxonomyBookCards(paging.ids),
    catalogueAvailability(paging.ids),
  ]);
  const readerReturnTo = pageHref(
    `/taxonomy/${familySlug}/${itemSlug}`,
    searchParams,
    paging.page,
  );
  const entityCount = item.direct;
  // Books show as cards; every other kind links to its list, filtered
  const others =
    family.entityLevel === "work"
      ? item.kindCounts.filter(({ kind, count }) => kind !== "book" && count > 0)
      : [];
  const othersList = wordList(
    others.map(({ kind }) => WORK_DOMAINS[kind].pluralLabel.toLowerCase()),
    "and",
  );
  const othersTitle = othersList.charAt(0).toUpperCase() + othersList.slice(1);

  return (
    <div>
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex flex-wrap items-center gap-1.5 text-sm text-fg-secondary"
      >
        <Link
          href="/taxonomy"
          className="transition-colors hover:text-fg-secondary min-w-0 break-words pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center"
        >
          Taxonomy
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`/taxonomy/${family.slug}`}
          className="transition-colors hover:text-fg-secondary min-w-0 break-words pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center"
        >
          {family.name}
        </Link>
        <span aria-hidden="true">/</span>
        {item.parents.map((parent) => (
          <span key={parent.id} className="contents">
            <Link
              href={`/taxonomy/${family.slug}/${parent.slug}`}
              className="text-command break-words touch-hit"
            >
              {parent.name}
            </Link>
            <span aria-hidden="true">/</span>
          </span>
        ))}
        <span
          aria-current="page"
          className="min-w-0 break-words text-fg-secondary"
        >
          {item.name}
        </span>
      </nav>

      {/* Item header */}
      <div className="mb-8">
        {/* The name steps down on a phone like every record title, its
            colour on the first line's cap height (SLN-877) */}
        <div
          data-title-length={titleLength(item.name)}
          className="type-page-title flex items-start gap-3"
        >
          {item.color && (
            <CapAligned height={14}>
              <span
                className="block h-3.5 w-3.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
            </CapAligned>
          )}
          <h1
            data-title-length={titleLength(item.name)}
            className="type-page-title min-w-0 [overflow-wrap:anywhere]"
          >
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
            {entityCount} {family.entityLevel}
            {entityCount === 1 ? "" : "s"}
            {item.children.length > 0 ? ` here, ${item.below} below` : ""}
          </Badge>
          {"createdAt" in item && item.createdAt && (
            <span className="font-mono text-micro text-fg-secondary">
              Created{" "}
              {new Date(item.createdAt as string | Date).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {(item.parents.length > 0 || item.children.length > 0) && (
        <section
          className="mb-8 space-y-3"
          aria-label="Classification hierarchy"
        >
          {item.parents.length > 0 && (
            <p className="text-sm text-fg-secondary">
              Parent:{" "}
              <Link
                className="text-command touch-hit"
                href={`/taxonomy/${family.slug}/${item.parents.at(-1)!.slug}`}
              >
                {item.parents.at(-1)!.name}
              </Link>
            </p>
          )}
          {item.children.length > 0 && (
            <div>
              <SectionHeading title="Child classifications" />
              <ul className="flex flex-wrap gap-x-4 gap-y-2">
                {item.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      className="text-sm text-command touch-hit"
                      href={`/taxonomy/${family.slug}/${child.slug}`}
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {/* Entity grid */}
      {entityWorks.length > 0 && (
        <div>
          <SectionHeading
            title={
              family.entityLevel === "edition"
                ? "Books with associated editions"
                : others.length > 0
                  ? "Books"
                  : "Associated works"
            }
          />
          <PaginatedSection {...paging} noun={others.length > 0 ? "books" : "works"} hideSingleSummary>
            <div className="@container">
              <div className="catalogue-grid catalogue-density-compact">
                {entityWorks.map((work) => {
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

                  const instanceCount =
                    work.editions?.reduce(
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
            </div>
          </PaginatedSection>
        </div>
      )}

      {others.length > 0 && (
        <div className={entityWorks.length > 0 ? "mt-8" : undefined}>
          <SectionHeading
            title={entityWorks.length > 0 ? othersTitle : "Associated works"}
          />
          <ul className="space-y-2 text-sm" data-item-kinds="">
            {others.map(({ kind, count }) => (
              <li key={kind}>
                <Link
                  href={filteredListHref(kind, family.slug, item.id)}
                  className="text-command touch-hit"
                >
                  {count.toLocaleString("en-US")}{" "}
                  {(count === 1
                    ? WORK_DOMAINS[kind].label
                    : WORK_DOMAINS[kind].pluralLabel
                  ).toLowerCase()}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {entityCount === 0 && (
        // What is tagged, in the catalogue's words, and where to tag it (SLN-816)
        <EmptyState
          icon={Tag}
          title="Nothing tagged yet"
          description={emptyDescription(family, item.kinds, item.name)}
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
  return {
    title:
      family && item ? `${item.name} · ${family.name}` : "Taxonomy not found",
  };
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
    <Suspense
      key={JSON.stringify(query)}
      fallback={<TaxonomySkeleton kind="term" />}
    >
      <ItemContent
        familySlug={familySlug}
        itemSlug={itemSlug}
        searchParams={query}
      />
    </Suspense>
  );
}
