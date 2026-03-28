import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

interface BookListItem {
  workId: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
}

export function BookList({ books }: { books: BookListItem[] }) {
  return (
    <div className="space-y-1">
      {books.map((book) => (
        <Link
          key={book.workId}
          href={`/library/${book.workId}`}
          className="group flex items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary"
        >
          {/* Small thumbnail */}
          <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded-[2px] bg-bg-tertiary">
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
                <span className="font-serif text-[8px] text-fg-muted/40">
                  {book.title[0]}
                </span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-serif text-sm text-fg-primary group-hover:text-accent-rose">
              {book.title}
            </h3>
            <p className="truncate text-xs text-fg-secondary">
              {book.authorName}
            </p>
          </div>

          {/* Meta */}
          <div className="flex flex-shrink-0 items-center gap-3">
            {book.publicationYear && (
              <span className="font-mono text-[10px] text-fg-muted">
                {book.publicationYear}
              </span>
            )}
            {book.rating && (
              <Badge variant="gold">{book.rating}/5</Badge>
            )}
            <span className="w-14 text-right font-mono text-[10px] text-fg-muted">
              {book.instanceCount} {book.instanceCount === 1 ? "copy" : "copies"}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
