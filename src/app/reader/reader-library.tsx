"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Search, BookOpenText, ChevronLeft, ChevronRight } from "lucide-react";
import type { CalibreBookRow } from "@/lib/calibre/queries";

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

  const totalPages = Math.ceil(total / limit);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const params = new URLSearchParams(searchParams.toString());
      if (searchValue) {
        params.set("q", searchValue);
      } else {
        params.delete("q");
      }
      params.delete("page");
      router.push(`/reader?${params.toString()}`);
    },
    [searchValue, searchParams, router],
  );

  const navigatePage = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (page > 1) {
        params.set("page", String(page));
      } else {
        params.delete("page");
      }
      router.push(`/reader?${params.toString()}`);
    },
    [searchParams, router],
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl text-fg-primary">Reader</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {total} {total === 1 ? "book" : "books"} in digital library
          </p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search by title or author..."
            className="w-full rounded-sm border border-glass-border bg-bg-primary/50 py-2 pl-9 pr-3 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-fg-muted/30"
          />
        </div>
      </form>

      {/* Continue Reading */}
      {recentlyRead.length > 0 && !query && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-muted">
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

      {/* All books */}
      <section>
        {query && (
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-muted">
            Results for &ldquo;{query}&rdquo;
          </h2>
        )}
        {books.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpenText
              className="mb-4 h-12 w-12 text-fg-muted"
              strokeWidth={1}
            />
            <p className="text-sm text-fg-muted">
              {query
                ? "No books match your search."
                : "No books in the digital library yet. Run the Calibre sync to populate."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
              {books.map((book) => (
                <ReaderBookCard key={book.id} book={book} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  onClick={() => navigatePage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="flex h-8 w-8 items-center justify-center rounded-sm border border-glass-border text-fg-secondary transition-colors hover:bg-bg-tertiary disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <span className="font-mono text-micro text-fg-muted">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => navigatePage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="flex h-8 w-8 items-center justify-center rounded-sm border border-glass-border text-fg-secondary transition-colors hover:bg-bg-tertiary disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            )}
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
    <Link
      href={`/reader/${book.calibreId}`}
      className="group relative flex flex-col overflow-hidden rounded-sm border border-glass-border bg-bg-secondary transition-all duration-200 hover:border-fg-muted/20 hover:shadow-lg hover:shadow-black/20"
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
            <span className="text-center font-serif text-xs text-fg-muted leading-tight">
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

        {/* Format badges */}
        <div className="absolute right-1.5 top-1.5 flex gap-1">
          {hasEpub && (
            <span className="rounded-sm bg-bg-primary/80 px-1.5 py-0.5 font-mono text-nano uppercase text-fg-muted backdrop-blur-sm">
              epub
            </span>
          )}
          {hasPdf && (
            <span className="rounded-sm bg-bg-primary/80 px-1.5 py-0.5 font-mono text-nano uppercase text-fg-muted backdrop-blur-sm">
              pdf
            </span>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-0.5 p-2">
        <h3 className="truncate text-xs font-medium text-fg-primary leading-tight">
          {book.title}
        </h3>
        {book.authorSort && (
          <p className="truncate text-micro text-fg-muted">
            {book.authorSort}
          </p>
        )}
      </div>
    </Link>
  );
}
