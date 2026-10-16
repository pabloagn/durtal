"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  removeWorkFromSeries,
  setSeriesPosition,
} from "@/lib/actions/series";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";
import { mediaUrl } from "@/lib/s3/media-url";
import { readingBadge } from "@/lib/reading/card";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";
import { EbookMark } from "@/components/books/ebook-mark";
import { COVER_CORNER } from "@/components/books/cover-chip";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";
import { FadeImage } from "@/components/shared/fade-image";
import { CatalogueReadLink } from "@/components/ebooks/catalogue-read-action";

/** A volume's reading: "Reading 44%", "Read", "Read 2×", "Abandoned" */
const badge = (book: SeriesBook) =>
  book.readingState
    ? readingBadge({
        state: book.readingState as "unread" | "reading" | "paused" | "read" | "abandoned",
        timesRead: book.timesRead ?? 0,
        percent: book.readingPercent ?? null,
      })
    : null;

export interface SeriesBook {
  id: string;
  slug: string;
  title: string;
  authors: string;
  position: string | null;
  cover: string | null;
  coverCrop: MediaCrop | null;
  /** The canonical catalogue status, as STATUS_CONFIG labels it */
  status: string;
  statusVariant: "muted" | "blue" | "gold" | "accent" | "sage" | "red";
  ebook?: WorkEbookDTO | null;
  readerReturnTo?: string;
  /** The volume's reading state (SLN-449) and the open reading's share */
  readingState?: string | null;
  timesRead?: number;
  readingPercent?: number | null;
}

function PositionField({
  seriesId,
  book,
}: {
  seriesId: string;
  book: SeriesBook;
}) {
  const router = useRouter();
  const [value, setValue] = useState(book.position ?? "");
  const [pending, start] = useTransition();
  function save() {
    if ((book.position ?? "") === value.trim()) return;
    start(async () => {
      const result = await setSeriesPosition(seriesId, book.id, value);
      if (!result.ok) {
        toast.error(result.error);
        setValue(book.position ?? "");
        return;
      }
      router.refresh();
    });
  }
  return (
    <input
      aria-label={`Position of ${book.title}`}
      data-tooltip="Position in the series (e.g. 1, 2, 2.5)"
      value={value}
      inputMode="decimal"
      maxLength={20}
      disabled={pending}
      placeholder="—"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        // Esc puts the number back; one layer per Esc
        if (e.key === "Escape") {
          e.preventDefault();
          setValue(book.position ?? "");
        }
      }}
      className="h-7 w-12 shrink-0 rounded-sm border border-glass-border bg-bg-primary/80 text-center font-mono text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent-primary focus:outline-none pointer-coarse:h-11"
    />
  );
}

/**
 * Books of a series in reading order: by volume number, then title. The order
 * changes only through the numbers typed here, so nothing rewrites one
 * (SLN-912).
 */
export function SeriesBooks({
  seriesId,
  books,
}: {
  seriesId: string;
  books: SeriesBook[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(book: SeriesBook) {
    if (busy) return;
    setBusy(book.id);
    try {
      await removeWorkFromSeries(seriesId, book.id);
      toast.success(`${book.title} removed from the series. Book kept.`);
      triggerActivityRefresh();
      router.refresh();
    } catch {
      toast.error("Could not update the series");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ol className="space-y-2">
      {books.map((book) => {
        // Read and remove: beside the title, or on their own row on a phone
        const readable = !!(book.ebook?.readable && book.ebook.readerPath);
        const read = <CatalogueReadLink ebook={book.ebook ?? null} returnTo={book.readerReturnTo} />;
        const removeButton = (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${book.title} from the series`}
            data-tooltip="Remove from series"
            disabled={!!busy}
            onClick={() => remove(book)}
          >
            <X size={14} />
          </Button>
        );
        // Centred: Read is 32px tall, the button 28px
        const controls = <div className="flex items-center gap-1 pointer-coarse:gap-2">{read}{removeButton}</div>;
        return (
          <li
            key={book.id}
            className="flex items-center gap-4 rounded-sm border border-glass-border bg-bg-secondary px-3 py-2.5"
          >
            <PositionField
              key={`${book.id}-${book.position}`}
              seriesId={seriesId}
              book={book}
            />
            <Link
              href={`/library/${book.slug}`}
              aria-label={`Open ${book.title}`}
            >
              {/* The title's letter with no cover, or one that fails */}
              <div className={`relative h-16 w-11 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary ${COVER_BLANK}`}>
                {book.cover ? (
                  <FadeImage
                    src={mediaUrl(book.cover)}
                    alt=""
                    loading="lazy"
                    className="protected-image absolute inset-0 h-full w-full object-cover"
                    style={mediaImageStyle(book.coverCrop)}
                    fallback={<CoverLetter title={book.title} />}
                  />
                ) : (
                  <CoverLetter title={book.title} />
                )}
                {book.ebook?.readable && <div className={COVER_CORNER.bottomLeft}><EbookMark ebook={book.ebook} /></div>}
              </div>
            </Link>
            <div className="min-w-0 flex-1">
              <div className="type-item-title flex items-start gap-4">
                <Link href={`/library/${book.slug}`} className="min-w-0 flex-1 touch-hit">
                  <h3 className="type-item-title break-words text-fg-primary hover:text-accent-primary">
                    {book.title}
                  </h3>
                </Link>
                {/* Under sm the row has no room: the badges move to the author
                    line and the controls to a row of their own. CapAlignedControls,
                    not CapAligned, whose box clips the buttons' focus rings */}
                <div className="hidden shrink-0 sm:block">
                  <CapAlignedControls height={32} coarseHeight={44}>
                    <span className="flex items-center gap-3">
                      <Badge variant={book.statusVariant}>{book.status}</Badge>
                      {badge(book) && (
                        <Badge variant={badge(book)!.variant}>{badge(book)!.label}</Badge>
                      )}
                      {controls}
                    </span>
                  </CapAlignedControls>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* A book with no author has no line here, so its badges start on the title's edge */}
                {book.authors && (
                  <p className="min-w-0 break-words text-xs text-fg-secondary">
                    {book.authors}
                  </p>
                )}
                <span className="shrink-0 sm:hidden">
                  <Badge variant={book.statusVariant}>{book.status}</Badge>
                </span>
                {badge(book) && (
                  <span className="shrink-0 sm:hidden">
                    <Badge variant={badge(book)!.variant}>{badge(book)!.label}</Badge>
                  </span>
                )}
              </div>
              {/* Pulled out by the first button's padding, so its icon sits on the title's edge:
                  Read's 8px, or a ghost icon button's 10px (14px on touch) */}
              <div className="mt-1 sm:hidden">
                <div className={`flex items-center gap-1 pointer-coarse:gap-2 ${readable ? "-ml-2" : "-ml-2.5 pointer-coarse:-ml-3.5"}`}>
                  {read}
                  {removeButton}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
