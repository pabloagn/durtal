import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { CalibreBookRow } from "@/lib/calibre/queries";

interface ReadButtonProps {
  calibreBooks: CalibreBookRow[];
}

/**
 * "Read" button shown on book detail pages when the work has
 * a matched digital edition in the Calibre library.
 *
 * If multiple Calibre books are linked, opens the first EPUB-capable one.
 */
export function ReadButton({ calibreBooks }: ReadButtonProps) {
  if (calibreBooks.length === 0) return null;

  // Prefer the book with an EPUB format available
  const preferred =
    calibreBooks.find((b) =>
      b.formats?.some((f) => f.format.toLowerCase() === "epub"),
    ) ?? calibreBooks[0];

  const formats = preferred.formats ?? [];
  const formatLabels = formats.map((f) => f.format.toUpperCase()).join(", ");

  return (
    <Link
      href={`/reader/${preferred.calibreId}`}
      className="inline-flex items-center gap-2 rounded-sm border border-glass-border bg-bg-secondary px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
      title={`Read (${formatLabels})`}
    >
      <BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
      <span>Read</span>
      {formats.length > 0 && (
        <span className="font-mono text-micro text-fg-muted">
          {formatLabels}
        </span>
      )}
    </Link>
  );
}
