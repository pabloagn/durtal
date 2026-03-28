import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { CatalogueStatus } from "@/lib/types";

const STATUS_CONFIG: Record<CatalogueStatus, { label: string; variant: "muted" | "blue" | "gold" | "rose" | "sage" | "red" }> = {
  tracked: { label: "Tracked", variant: "muted" },
  shortlisted: { label: "Shortlisted", variant: "blue" },
  wanted: { label: "Wanted", variant: "gold" },
  on_order: { label: "On Order", variant: "rose" },
  accessioned: { label: "Accessioned", variant: "sage" },
  deaccessioned: { label: "Deaccessioned", variant: "red" },
};

interface BookListItem {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
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
