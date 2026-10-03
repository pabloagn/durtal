import Link from "next/link";
import { BookOpen } from "lucide-react";

/**
 * One edition as a card: cover, title, authors, publication line and ISBN,
 * with a footer row for actions or badges. Every line is fixed, so all
 * edition cards share one height.
 */
export function EditionCard({
  href,
  title,
  imageKey,
  authorNames,
  details,
  isbn,
  footer,
}: {
  href: string;
  title: string;
  /** S3 key of the cover or thumbnail */
  imageKey?: string | null;
  authorNames: string[];
  /** Publication details, joined with a middle dot */
  details: (string | number | null | undefined)[];
  isbn?: string | null;
  footer?: React.ReactNode;
}) {
  return (
    <article className="flex gap-4 rounded-sm border border-glass-border bg-bg-secondary p-4">
      <Link
        href={href}
        className="flex h-32 w-20 shrink-0 items-center justify-center rounded-sm bg-bg-primary"
      >
        {imageKey ? (
          <img
            src={`/api/s3/read?key=${encodeURIComponent(imageKey)}`}
            alt={title}
            className="h-full w-full object-contain"
          />
        ) : (
          <BookOpen size={24} className="text-fg-muted" strokeWidth={1.5} />
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={href}
          className="lines-2 font-serif text-xl text-fg-primary transition-colors hover:text-accent-rose"
        >
          {title}
        </Link>
        <p className="mt-1 lines-1 text-sm text-fg-secondary">
          {authorNames.join(" & ")}
        </p>
        <p className="mt-2 lines-1 text-xs text-fg-muted">
          {details.filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 lines-1 font-mono text-xs text-fg-muted">{isbn}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {footer}
        </div>
      </div>
    </article>
  );
}
