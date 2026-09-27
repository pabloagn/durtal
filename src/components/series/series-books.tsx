"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  moveSeriesWork,
  removeWorkFromSeries,
  setSeriesPosition,
} from "@/lib/actions/series";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";

export interface SeriesBook {
  id: string;
  slug: string;
  title: string;
  authors: string;
  position: string | null;
  cover: string | null;
  coverCrop: MediaCrop | null;
  owned: boolean;
  status: string;
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
      title="Position in the series (e.g. 1, 2, 2.5)"
      value={value}
      inputMode="decimal"
      maxLength={20}
      disabled={pending}
      placeholder="—"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setValue(book.position ?? "");
      }}
      className="h-7 w-12 rounded-sm border border-glass-border bg-bg-primary/80 text-center font-mono text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
    />
  );
}

/** Books of a series in reading order: position, move up/down, remove. */
export function SeriesBooks({
  seriesId,
  books,
}: {
  seriesId: string;
  books: SeriesBook[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(book: SeriesBook, action: "up" | "down" | "remove") {
    if (busy) return;
    setBusy(book.id);
    try {
      if (action === "remove") {
        await removeWorkFromSeries(seriesId, book.id);
        toast.success(`${book.title} removed from the series. Book kept.`);
        triggerActivityRefresh();
      } else {
        await moveSeriesWork(seriesId, book.id, action === "up" ? -1 : 1);
      }
      router.refresh();
    } catch {
      toast.error("Could not update the series");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ol className="space-y-2">
      {books.map((book, index) => (
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
            className="flex min-w-0 flex-1 items-center gap-4"
          >
            <div className="h-16 w-11 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
              {book.cover && (
                <img
                  src={`/api/s3/read?key=${encodeURIComponent(book.cover)}`}
                  alt=""
                  className="protected-image h-full w-full object-cover"
                  style={mediaImageStyle(book.coverCrop)}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-1 font-serif text-lg text-fg-primary hover:text-accent-rose">
                {book.title}
              </h3>
              <p className="line-clamp-1 text-xs text-fg-secondary">
                {book.authors}
              </p>
            </div>
          </Link>
          {book.owned ? (
            <Badge variant="sage">Owned</Badge>
          ) : (
            <Badge variant="muted">{book.status}</Badge>
          )}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move ${book.title} earlier`}
              title="Move earlier"
              disabled={!!busy || index === 0}
              onClick={() => act(book, "up")}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move ${book.title} later`}
              title="Move later"
              disabled={!!busy || index === books.length - 1}
              onClick={() => act(book, "down")}
            >
              <ArrowDown size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${book.title} from the series`}
              title="Remove from series"
              disabled={!!busy}
              onClick={() => act(book, "remove")}
            >
              <X size={14} />
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
}
