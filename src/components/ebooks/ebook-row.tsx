import Link from "next/link";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { CapAligned } from "@/components/shared/cap-aligned";
import { EbookCover, EbookLinkedMark } from "./ebook-card";
import { formatLabel } from "@/lib/ebooks/formats";
import { formatBytes } from "@/lib/ebooks/run-text";
import { languageName } from "@/lib/utils/language";
import type { EbookCardData } from "@/lib/ebooks/library-view";
export function EbookRow({ book, returnTo }: { book: EbookCardData; returnTo?: string }) {
  const authors = book.authors.join(", ") || "Unknown author";
  return (
    <tr className="border-b border-glass-border align-top">
      <td className="w-12 py-3 pr-3">
        <Link href={`/ebooks/${book.id}`} aria-label={book.title}>
          <EbookCover book={book} sizes="48px" />
        </Link>
      </td>
      <td className="py-3 @min-[52rem]:min-w-[13rem] @min-[52rem]:pr-4">
        {/* Read sits on the title's first line, apart from it: run together
            they read "The Broken SealRead" */}
        <div className="type-item-title flex items-start justify-between gap-3">
          <Link
            href={`/ebooks/${book.id}`}
            className="min-w-0 [overflow-wrap:anywhere]"
          >
            {book.title}
          </Link>
          {book.readHref && (
            <CapAligned height={32} coarseHeight={44}>
              <ReaderEntryLink
                readerPath={book.readHref}
                returnTo={returnTo}
                className="inline-flex h-full items-center rounded-sm px-2.5 font-sans text-xs text-accent-primary hover:bg-bg-tertiary"
                aria-label={`Read ${book.title}`}
              >
                Read
              </ReaderEntryLink>
            </CapAligned>
          )}
        </div>
        {/* In a column under 52rem (the table's full width) the row stacks: the
            author, then formats and size in place of the columns, so the list
            never scrolls sideways, on a phone or beside the sidebar */}
        <p className="mt-1 text-xs text-fg-secondary @min-[52rem]:hidden">
          {authors}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-fg-secondary @min-[52rem]:hidden">
          <span>
            {book.formats.map(formatLabel).join(" · ") || "No downloadable files"}
            {" · "}
            <span className="font-mono">{formatBytes(book.sizeBytes)}</span>
          </span>
          {book.linked && <EbookLinkedMark />}
        </p>
      </td>
      <td className="min-w-48 py-3 pr-4 text-xs @max-[52rem]:hidden">
        {authors}
      </td>
      <td className="py-3 pr-4 text-xs @max-[52rem]:hidden">
        {book.formats.map(formatLabel).join(" · ") || "—"}
      </td>
      <td className="py-3 pr-4 text-xs @max-[52rem]:hidden">
        {languageName(book.language) || "—"}
      </td>
      <td className="whitespace-nowrap py-3 pr-4 font-mono text-xs @max-[52rem]:hidden">
        {formatBytes(book.sizeBytes)}
      </td>
      <td className="py-3 pr-4 text-xs @max-[52rem]:hidden">
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
      <td className="whitespace-nowrap py-3 font-mono text-xs @max-[52rem]:hidden">
        {book.added.slice(0, 10)}
      </td>
    </tr>
  );
}
