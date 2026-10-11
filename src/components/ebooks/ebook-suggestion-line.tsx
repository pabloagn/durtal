import Link from "next/link";

export function EbookSuggestionLine({ workId, authorId, seriesId, count }: { workId?: string; authorId?: string; seriesId?: string; count: number }) {
  if (!count) return null;
  const scope = workId ? `work=${workId}` : authorId ? `author=${authorId}` : seriesId ? `series=${seriesId}` : null;
  if (!scope) return null;
  return <p className="mt-3 text-xs text-fg-secondary">{count} {count === 1 ? "eBook suggestion" : "eBook suggestions"} {workId ? "for this book" : authorId ? "for this author’s books" : "for this series"} ·{" "}
    <Link href={`/ebooks/review?${scope}`} className="text-fg-primary underline underline-offset-2">Review</Link>
  </p>;
}
