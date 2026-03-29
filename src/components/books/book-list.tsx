import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/constants/catalogue";
import type { CatalogueStatus, AcquisitionPriority } from "@/lib/types";
import type { CoverCrop } from "./book-card";

interface BookListItem {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  coverCrop?: CoverCrop | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
  acquisitionPriority?: string | null;
}

export function BookList({ books }: { books: BookListItem[] }) {
  return (
    <div className="space-y-px">
      {books.map((book) => (
        <Link
          key={book.workId}
          href={`/library/${book.slug}`}
          className="group flex items-center gap-3 rounded-sm px-3 py-2.5 transition-colors hover:bg-bg-secondary/60"
        >
          {/* Small thumbnail */}
          <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
            {book.coverUrl ? (
              <Image
                src={book.coverUrl}
                alt={book.title}
                fill
                sizes="28px"
                className="object-cover"
                style={
                  book.coverCrop &&
                  (book.coverCrop.x !== 50 ||
                    book.coverCrop.y !== 50 ||
                    book.coverCrop.zoom !== 100)
                    ? {
                        objectPosition: `${book.coverCrop.x}% ${book.coverCrop.y}%`,
                        transform: `scale(${book.coverCrop.zoom / 100})`,
                        transformOrigin: `${book.coverCrop.x}% ${book.coverCrop.y}%`,
                      }
                    : undefined
                }
              unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="font-serif text-nano text-fg-muted/40">
                  {book.title[0]}
                </span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-serif text-lg text-fg-primary transition-colors group-hover:text-accent-rose">
              {book.title}
            </h3>
            <p className="truncate text-sm text-fg-secondary">
              {book.authorName}
            </p>
          </div>

          {/* Meta */}
          <div className="flex flex-shrink-0 items-center gap-3">
            {(() => {
              const statusInfo = book.catalogueStatus
                ? STATUS_CONFIG[book.catalogueStatus as CatalogueStatus]
                : null;
              return statusInfo ? (
                <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              ) : null;
            })()}
            {(() => {
              const priorityInfo =
                book.acquisitionPriority && book.acquisitionPriority !== "none"
                  ? PRIORITY_CONFIG[book.acquisitionPriority as AcquisitionPriority]
                  : null;
              return priorityInfo ? (
                <span
                  className={`inline-block h-2 w-2 rounded-full ${priorityInfo.dotColor}`}
                  title={priorityInfo.label}
                />
              ) : null;
            })()}
            {book.publicationYear && (
              <span className="font-mono text-micro text-fg-muted">
                {book.publicationYear}
              </span>
            )}
            {book.rating && (
              <Badge variant="gold">{book.rating}/5</Badge>
            )}
            <span className="w-14 text-right font-mono text-micro text-fg-muted">
              {book.instanceCount} {book.instanceCount === 1 ? "copy" : "copies"}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
