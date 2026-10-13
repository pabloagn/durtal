import Link from "next/link";
import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import { EbookCover } from "./ebook-card";
import type { EbookCardData } from "@/lib/ebooks/library-view";
import { formatPercent } from "@/lib/reader/place-label";
export interface ContinueCard {
  book: EbookCardData;
  href: string;
  savedPercent: number;
  projection: boolean;
  device: string;
  chapter: string | null;
  when: string;
}
export function ContinueReading({ books }: { books: ContinueCard[] }) {
  if (!books.length) return null;
  return (
    <section className="mb-8">
      <HorizontalCarousel title="Continue reading">
        {books.map((item) => (
          <Link
            key={item.book.id}
            href={item.href}
            className="w-52 shrink-0 snap-start rounded-sm transition-colors hover:text-accent-primary"
          >
            <EbookCover book={item.book} sizes="208px" />
            <h3 className="type-item-title mt-3 [overflow-wrap:anywhere]">
              {item.book.title}
            </h3>
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
              {formatPercent(item.savedPercent)} · {item.device} · {item.when}
            </p>
            {item.projection && (
              <p className="mt-1 text-xs text-fg-secondary">
                Resume in the current file
              </p>
            )}
            {item.chapter && (
              <p className="mt-1 text-xs text-fg-secondary">{item.chapter}</p>
            )}
          </Link>
        ))}
      </HorizontalCarousel>
    </section>
  );
}
