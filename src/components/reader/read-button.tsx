import { BookOpen } from "lucide-react";
import type { EbookRow } from "@/lib/ebooks/queries";
import { formatLabel, isReadableFormat } from "@/lib/ebooks/formats";

interface ReadButtonProps {
  ebooks: EbookRow[];
}

/** A file the reader can open: a readable format, stored or verified, without DRM */
const openable = (f: EbookRow["files"][number]) =>
  isReadableFormat(f.format) && (f.status === "stored" || f.status === "verified") && !f.drm;

/**
 * "Read" on a book page when an e-book is linked to one of its copies. It
 * opens the first e-book the reader can open, in /reader/[ebookId].
 */
export function ReadButton({ ebooks }: ReadButtonProps) {
  const preferred = ebooks.find((e) => e.files.some(openable));
  if (!preferred) return null;
  const formats = [...new Set(preferred.files.filter(openable).map((f) => formatLabel(f.format)))].join(", ");

  return (
    // A full page load: the reader's page brings its own content policy (eBooks sub-issue 3)
    <a
      href={`/reader/${preferred.id}`}
      className="inline-flex h-8 items-center gap-2 rounded-sm border border-glass-border bg-bg-secondary px-3 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:h-11"
      data-read-button
      data-tooltip={`Read the eBook (${formats})`}
    >
      <BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
      <span>Read</span>
      <span className="font-mono text-micro text-fg-secondary">{formats}</span>
    </a>
  );
}
