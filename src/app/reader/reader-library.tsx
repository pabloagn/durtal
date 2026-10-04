"use client";

import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { clearedListHref, firstPageHref } from "@/lib/utils/list-params";
import { EmptyState } from "@/components/ui/empty-state";
import { NoResults } from "@/components/shared/no-results";

import { Pagination } from "@/components/shared/pagination";
import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Search, BookOpenText } from "lucide-react";
import type { CalibreBookRow } from "@/lib/calibre/queries";
import { PageHeader } from "@/components/layout/page-header";
import { COVER_CHIP, COVER_CHIP_TEXT, COVER_CORNER } from "@/components/books/cover-chip";

interface ReaderLibraryProps {
  books: CalibreBookRow[];
  total: number;
  currentPage: number;
  limit: number;
  query: string;
  recentlyRead: {
    progress: { progressPercent: number | null; lastReadAt: Date };
    book: CalibreBookRow;
  }[];
}

export function ReaderLibrary({
  books,
  total,
  currentPage,
  limit,
  query,
  recentlyRead,
}: ReaderLibraryProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(query);



  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const params = new URLSearchParams(searchParams.toString());
      if (searchValue) {
        params.set("q", searchValue);
      } else {
        params.delete("q");
      }
      router.push(firstPageHref("/reader", params));
    },
    [searchValue, searchParams, router],
  );

  const header = (
    <PageHeader
      title="Reader"
      description={`${total} ${total === 1 ? "book" : "books"} in digital library`}
    />
  );

  // No books and no search: the empty state alone
  if (total === 0 && !query) {
    return (
      <div>
        {header}
        <EmptyState
          icon={BookOpenText}
          title="No books yet"
          description="Run the Calibre sync to fill the digital library."
        />
      </div>
    );
  }

  return (
    <div>
      {header}

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search by title or author..."
            className="w-full rounded-sm border border-glass-border bg-bg-primary/50 py-2 pl-9 pr-3 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-accent-rose"
          />
        </div>
      </form>

      {/* Continue Reading */}
      {recentlyRead.length > 0 && !query && (
        <section className="mb-8">
          <h2 className="type-caption mb-3">
            Continue Reading
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {recentlyRead.map(({ book, progress }) => (
              <ReaderBookCard
                key={book.id}
                book={book}
                progress={progress.progressPercent ?? undefined}
              />
            ))}
          </div>
        </section>
      )}

      <Pagination page={currentPage} perPage={limit} total={total} noun="books" compact />

      {/* All books */}
      <section>
        {query && (
          <h2 className="type-caption mb-3">
            Results for &ldquo;{query}&rdquo;
          </h2>
        )}
        {books.length === 0 ? (
          <NoResults
            noun="books"
            search={query}
            hasFilters={false}
            clearHref={clearedListHref("/reader", searchParams)}
          />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
              {books.map((book) => (
                <ReaderBookCard key={book.id} book={book} />
              ))}
            </div>

            <Pagination page={currentPage} perPage={limit} total={total} noun="books" />
          </>
        )}
      </section>
    </div>
  );
}

// ── Book Card ────────────────────────────────────────────────────────────────

function ReaderBookCard({
  book,
  progress,
}: {
  book: CalibreBookRow;
  progress?: number;
}) {
  const formats = book.formats ?? [];
  const hasEpub = formats.some((f) => f.format.toLowerCase() === "epub");
  const hasPdf = formats.some((f) => f.format.toLowerCase() === "pdf");

  return (
    <div className="relative">
    <Link
      href={`/reader/${book.calibreId}`}
      className="group @container relative flex flex-col overflow-hidden rounded-sm border border-glass-border bg-bg-secondary transition-all duration-200 hover:border-fg-muted/20 hover:shadow-lg hover:shadow-black/20"
    >
      {/* Cover */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-tertiary">
        {book.hasCover ? (
          <Image
            src={`/api/reader/${book.calibreId}/cover`}
            alt={book.title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 12.5vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-3">
            <span className="text-center font-serif text-xs text-fg-secondary leading-tight">
              {book.title}
            </span>
          </div>
        )}

        {/* Progress overlay */}
        {progress !== undefined && progress > 0 && (
          <div className="absolute inset-x-0 bottom-0">
            <div className="h-1 w-full bg-bg-primary/60">
              <div
                className="h-full bg-accent-rose"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Format badges: cover chips, like the marks on a book card */}
        <div className={COVER_CORNER.topRight}>
          {hasEpub && (
            <span className={`${COVER_CHIP} ${COVER_CHIP_TEXT} uppercase text-fg-primary`}>
              epub
            </span>
          )}
          {hasPdf && (
            <span className={`${COVER_CHIP} ${COVER_CHIP_TEXT} uppercase text-fg-primary`}>
              pdf
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-0.5 p-2">
        <h3 className="type-item-title truncate">
          {book.title}
        </h3>
        {book.authorSort && (
          <p className="truncate text-micro text-fg-secondary">
            {book.authorSort}
          </p>
        )}
      </div>
    </Link>
    {book.coverS3Key && <ImageAdjustButton source={`/api/reader/${book.calibreId}/cover`} label="Adjust reader cover" className="absolute left-1.5 top-1.5" />}
    </div>
  );
}
