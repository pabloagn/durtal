import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { EbookCover } from "./ebook-card";
import type { EbookCardData } from "@/lib/ebooks/library-view";
import { formatPercent } from "@/lib/reader/place-label";
export interface ContinueCard {
  book: EbookCardData;
  href: string;
  savedPercent: number;
  projection: boolean;
  chapter: string | null;
  when: string;
}
/**
 * The books being read, newest first (SLN-683). A document link with a return
 * route, so the reader's Back names this page and goes to it. On a phone a
 * card is a cover beside its text, so the row stays one line that scrolls.
 */
export function ContinueReading({ books }: { books: ContinueCard[] }) {
  if (!books.length) return null;
  return (
    <section className="mb-8">
      <HorizontalCarousel title="Continue reading">
        {books.map((item) => (
          <ReaderEntryLink
            key={item.book.id}
            readerPath={item.href}
            returnTo="/ebooks"
            className="group flex w-72 shrink-0 snap-start gap-4 rounded-sm sm:block sm:w-52"
          >
            <div className="w-20 shrink-0 sm:w-auto">
              <EbookCover book={item.book} sizes="(max-width: 639px) 80px, 208px" />
            </div>
            <div className="min-w-0 flex-1 sm:mt-3">
              <h3 className="type-item-title transition-colors [overflow-wrap:anywhere] group-hover:text-accent-primary">
                {item.book.title}
              </h3>
              {item.book.authors.length > 0 && (
                <p className="mt-1 text-sm text-fg-secondary [overflow-wrap:anywhere]">
                  {item.book.authors.join(", ")}
                </p>
              )}
              <div
                className="mt-2 h-0.5 overflow-hidden rounded-sm bg-bg-tertiary"
                aria-hidden
              >
                <div
                  className="h-full bg-accent-primary"
                  style={{ width: `${item.savedPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-fg-secondary">
                {item.projection ? "Saved " : ""}
                {formatPercent(item.savedPercent)} · {item.when}
              </p>
              {item.chapter && (
                <p className="mt-1 text-xs text-fg-secondary [overflow-wrap:anywhere]">
                  {item.chapter}
                </p>
              )}
            </div>
          </ReaderEntryLink>
        ))}
      </HorizontalCarousel>
    </section>
  );
}
