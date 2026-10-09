import Link from "next/link";
import { EbookCover, EbookLinkedMark } from "./ebook-card";
import { formatLabel } from "@/lib/ebooks/formats";
import { formatBytes } from "@/lib/ebooks/run-text";
import { languageName } from "@/lib/utils/language";
import type { EbookCardData } from "@/lib/ebooks/library-view";
export function EbookRow({ book }: { book: EbookCardData }) {
  return (
    <tr className="border-b border-glass-border align-top">
      <td className="w-12 py-3 pr-3">
        <Link href={`/ebooks/${book.id}`} aria-label={book.title}>
          <EbookCover book={book} sizes="48px" />
        </Link>
      </td>
      <td className="min-w-[13rem] py-3 pr-4">
        <Link
          href={`/ebooks/${book.id}`}
          className="type-item-title [overflow-wrap:anywhere]"
        >
          {book.title}
        </Link>
        <p className="mt-1 text-xs text-fg-secondary">
          {book.authors.join(", ") || "Unknown author"}
        </p>
        {book.readHref && (
          <Link
            href={book.readHref}
            className="mt-1 inline-block text-xs text-accent-primary touch-hit"
          >
            Read
          </Link>
        )}
      </td>
      <td className="py-3 pr-4 text-xs">
        {book.formats.map(formatLabel).join(" · ") || "—"}
      </td>
      <td className="py-3 pr-4 text-xs">
        {languageName(book.language) || "—"}
      </td>
      <td className="whitespace-nowrap py-3 pr-4 font-mono text-xs">
        {formatBytes(book.sizeBytes)}
      </td>
      <td className="py-3 pr-4 text-xs">
        {book.linked ? (
          <EbookLinkedMark />
        ) : book.state === "standalone" ? (
          "Kept as eBook"
        ) : book.state === "excluded" ? (
          "Set aside"
        ) : (
          "Not linked"
        )}
      </td>
      <td className="whitespace-nowrap py-3 font-mono text-xs">
        {book.added.slice(0, 10)}
      </td>
    </tr>
  );
}
