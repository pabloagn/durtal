import type { Metadata } from "next";
import { catalogueAvailability } from "@/lib/ebooks/catalogue-availability";
import { pageHref } from "@/lib/utils/pagination";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { cache } from "react";
import { BackLink } from "@/components/shared/back-link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { paginateItems, type ListSearchParams } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { BookCard } from "@/components/books/book-card";
import { cardReadingOf } from "@/lib/reading/card";
import { recommenderStats } from "@/lib/reading/stats";
import { DetailControls, DetailTitleRow } from "@/components/shared/detail-layout";
import { getRecommender } from "@/lib/actions/recommenders";
import { websiteLabel } from "@/lib/validations/recommenders";
import { mediaCrop } from "@/lib/utils/media-style";
import { RecommenderActions } from "./recommender-actions";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { SectionHeading } from "@/components/shared/section-heading";
import { mediaUrl } from "@/lib/s3/media-url";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListSearchParams>;
}

/** One read per request for the page and its title */
const loadRecommender = cache(getRecommender);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const recommender = await loadRecommender((await params).id);
  return { title: recommender?.name ?? "Recommender not found" };
}

export default async function RecommenderPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  // Their track record from taste evidence (SLN-457), the stats page's All time
  // numbers, needs nothing from the recommender: it runs beside their books and
  // the books' eBooks rather than after them (SLN-817)
  const stats = recommenderStats(null);
  // Awaited below; a page that ends sooner (not found) leaves no unhandled rejection
  stats.catch(() => {});
  const recommender = await loadRecommender(id);
  if (!recommender) notFound();
  const books = recommender.books;
  const query = await searchParams;
  const paging = paginateItems(books, query);
  const [digital, allStats] = await Promise.all([
    catalogueAvailability(paging.items.map((work) => work.id)),
    stats,
  ]);
  const readerReturnTo = pageHref(`/recommenders/${id}`, query, paging.page);
  const count = books.length;
  // Read: a finished reading at least (SLN-449)
  const read = books.filter((w) => Number(w.timesRead) >= 1).length;
  const record = allStats.find((r) => r.recommenderId === recommender.id);

  return (
    <>
      <CopyShortcuts name={recommender.name} />
      <BackLink href="/recommenders">Back to recommenders</BackLink>

      {/* Header, as on series pages (no poster or cover): a long name steps
          down on a phone, and the controls go under it when it will not fit */}
      <header className="mb-8 min-w-0">
        <DetailTitleRow title={recommender.name} controls="free">
          <DetailControls>
            <FavouriteToggle
              favourite={recommender.isFavourite}
              target={{ entity: "recommender", id: recommender.id }}
              name={recommender.name}
              shortcut
            />
            <RecommenderActions
              recommender={{
                id: recommender.id,
                name: recommender.name,
                url: recommender.url,
              }}
              bookCount={count}
            />
          </DetailControls>
        </DetailTitleRow>
        {/* As tall as the website link (24px), with or without one, as the loading screen draws it */}
        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-3 text-sm">
          {recommender.url && (
            <a
              href={recommender.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 font-medium text-fg-primary transition-colors hover:text-accent-primary touch-hit"
            >
              <ExternalLink
                className="h-3.5 w-3.5 shrink-0"
                strokeWidth={1.5}
              />
              <span className="truncate">
                {websiteLabel(recommender.url)}
              </span>
            </a>
          )}
          <span className="font-mono text-xs text-fg-secondary">
            {count} {count === 1 ? "book" : "books"} recommended
          </span>
          {read > 0 && (
            <span className="text-xs text-fg-secondary" data-recommender-read="">
              {`You have read ${read} of their ${count} ${count === 1 ? "pick" : "picks"}`}
            </span>
          )}
          {record && record.rated > 0 && record.avgRating !== null && (
            <span className="text-xs text-fg-secondary" data-recommender-record="">
              {`You rated ${record.liked} of their ${record.rated} ${record.rated === 1 ? "pick" : "picks"} 4 or more; average ${(Math.round(record.avgRating * 10) / 10).toFixed(1)}`}
            </span>
          )}
        </div>
      </header>

      <section className="mb-8">
        <SectionHeading title="Books" count={count} />
        {count === 0 ? (
          <p className="rounded-sm border border-dashed border-glass-border px-6 py-10 text-center text-sm text-fg-secondary [overflow-wrap:anywhere]">
            {`No books yet. Add ${recommender.name} in a book's Edit dialog, under Recommended by.`}
          </p>
        ) : (
          <PaginatedSection {...paging} noun="books">
            <div className="@container">
            <div className="catalogue-grid catalogue-density-compact" data-recommender-books="">
              {paging.items.map((work) => {
                const poster = work.media?.find(
                  (m) => m.type === "poster" && m.isActive,
                );
                const coverKey =
                  poster?.thumbnailS3Key ??
                  poster?.s3Key ??
                  work.editions[0]?.thumbnailS3Key ??
                  work.editions[0]?.coverS3Key;
                return (
                  <BookCard
                    key={work.id}
                    workId={work.id}
                    ebook={digital.get(work.id)?.read ?? null}
                    readerReturnTo={readerReturnTo}
                    slug={work.slug ?? ""}
                    title={work.title}
                    authorName={work.workAuthors[0]?.author?.name ?? "Unknown"}
                    authorNames={work.workAuthors.map((wa) => wa.author.name)}
                    coverUrl={
                      coverKey
                        ? mediaUrl(coverKey)
                        : null
                    }
                    coverCrop={poster ? mediaCrop(poster) : null}
                    coverTone={poster?.tone ?? null}
                    publicationYear={
                      work.editions[0]?.publicationYear ?? work.originalYear
                    }
                    language={work.editions[0]?.language}
                    instanceCount={work.copyCount}
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
            </div>
          </PaginatedSection>
        )}
      </section>
    </>
  );
}
