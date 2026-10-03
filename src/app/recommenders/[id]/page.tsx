import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { paginateItems, type ListSearchParams } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { BookCard } from "@/components/books/book-card";
import { CapAligned } from "@/components/shared/cap-aligned";
import { getRecommender } from "@/lib/actions/recommenders";
import { websiteLabel } from "@/lib/validations/recommenders";
import { mediaCrop } from "@/lib/utils/media-style";
import { RecommenderActions } from "./recommender-actions";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { SectionHeading } from "@/components/shared/section-heading";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListSearchParams>;
}

export default async function RecommenderPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const recommender = await getRecommender(id);
  if (!recommender) notFound();
  const books = recommender.books;
  const paging = paginateItems(books, await searchParams);
  const count = books.length;

  return (
    <>
      <CopyShortcuts name={recommender.name} />
      <Link
        href="/recommenders"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to recommenders
      </Link>

      {/* Header, as on author pages (no poster or cover) */}
      <header className="mb-8 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="type-page-title break-words">
            {recommender.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            {recommender.url && (
              <a
                href={recommender.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 font-medium text-fg-primary transition-colors hover:text-accent-rose-text"
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
          </div>
        </div>
        <CapAligned height={32} className="font-serif text-4xl tracking-tight">
          <RecommenderActions
            recommender={{
              id: recommender.id,
              name: recommender.name,
              url: recommender.url,
            }}
            bookCount={count}
          />
        </CapAligned>
      </header>

      <section className="mb-8">
        <SectionHeading title="Books" count={count} />
        {count === 0 ? (
          <p className="rounded-sm border border-dashed border-glass-border px-6 py-10 text-center text-sm text-fg-secondary">
            {`No books yet. Add ${recommender.name} in a book's Edit dialog, under Recommended by.`}
          </p>
        ) : (
          <PaginatedSection {...paging} noun="books">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {paging.items.map((work) => {
                const poster = work.media?.find(
                  (m) => m.type === "poster" && m.isActive,
                );
                const coverKey =
                  poster?.thumbnailS3Key ??
                  poster?.s3Key ??
                  work.editions[0]?.thumbnailS3Key;
                return (
                  <BookCard
                    key={work.id}
                    workId={work.id}
                    slug={work.slug ?? ""}
                    title={work.title}
                    authorName={work.workAuthors[0]?.author?.name ?? "Unknown"}
                    authorNames={work.workAuthors.map((wa) => wa.author.name)}
                    coverUrl={
                      coverKey
                        ? `/api/s3/read?key=${encodeURIComponent(coverKey)}`
                        : null
                    }
                    coverCrop={poster ? mediaCrop(poster) : null}
                    publicationYear={
                      work.editions[0]?.publicationYear ?? work.originalYear
                    }
                    language={work.editions[0]?.language}
                    instanceCount={work.editions[0]?.instances?.length ?? 0}
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
        )}
      </section>
    </>
  );
}
