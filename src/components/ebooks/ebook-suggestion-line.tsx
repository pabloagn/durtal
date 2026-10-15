import Link from "next/link";

/**
 * "3 eBook suggestions for this book · Review". In a header it follows the
 * line above (`mt-3`, the default); at the top of a page's column it opens
 * that column and keeps a section's space under it (`mb-8`).
 */
export function EbookSuggestionLine({ workId, authorId, seriesId, count, className = "mt-3" }: { workId?: string; authorId?: string; seriesId?: string; count: number; className?: string }) {
  if (!count) return null;
  const scope = workId ? `work=${workId}` : authorId ? `author=${authorId}` : seriesId ? `series=${seriesId}` : null;
  if (!scope) return null;
  return <p className={`text-xs text-fg-secondary ${className}`}>{count} {count === 1 ? "eBook suggestion" : "eBook suggestions"} {workId ? "for this book" : authorId ? "for this author’s books" : "for this series"} ·{" "}
    <Link href={`/ebooks/review?${scope}`} className="text-fg-primary underline underline-offset-2">Review</Link>
  </p>;
}
