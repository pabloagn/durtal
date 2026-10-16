import Link from "next/link";
import { CardHeading } from "@/components/shared/card-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { buttonClass } from "@/components/ui/button";
import { ProgressBar } from "@/components/shared/progress-bar";
import { formatReadingDate } from "@/lib/reading/dates";
import { agoText, lastReadText, positionText, type DayContext } from "@/lib/reading/labels";
import type { getOpenReadings } from "@/lib/actions/reading";
import type { FinishedRead } from "@/lib/reading/journal";
import type { ReadingEstimate } from "@/lib/reading/pace";
import { ReadingCardActions, ResumeButton } from "./hub-actions";
import { EstimateLine } from "./estimate-line";
import { Cover, type FinishedItem, type TileItem } from "./reading-tiles";

/*
 * The reading hub's and the dashboard's cards (SLN-448), rendered on the
 * server; only their buttons are client islands.
 */

export type OpenReading = Awaited<ReturnType<typeof getOpenReadings>>[number];

const bookHref = (work: { id: string; slug: string | null }) => `/library/${work.slug ?? work.id}`;
const refOf = (o: OpenReading) => ({ workId: o.work.id, readingId: o.reading.id, fingerprint: o.fingerprint });
const progressLabel = (o: OpenReading) => {
  const r = o.reading;
  const pct = `${Math.round(r.currentPercent ?? 0)} percent`;
  return r.unit === "pages" && r.currentPage != null && r.totalPages ? `${pct}, page ${r.currentPage} of ${r.totalPages}` : pct;
};

/** A reading in progress: cover, title, author, progress, last read, Log progress and its menu */
export function CurrentReadingCard({ open, day, estimate }: { open: OpenReading; day: DayContext; estimate?: ReadingEstimate }) {
  const r = open.reading;
  const href = bookHref(open.work);
  const last = lastReadText(r.lastReadAt, day);
  return (
    // The actions sit under the text, or under the cover and text when the card is too narrow for them
    <article className="@container grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4 rounded-sm border border-glass-border bg-bg-secondary p-4 @[280px]:grid-rows-[auto_1fr]" data-hub-card={r.id} data-focus-row="">
      <Cover s3Key={open.cover} title={open.work.title} className="h-24 w-16 @[280px]:row-span-2" />
      <div className="min-w-0">
        <CardHeading
          title={
            <Link href={href} className="transition-colors hover:text-accent-primary">
              {open.work.title}
            </Link>
          }
          subtitle={open.author ?? ""}
        />
        <ProgressBar value={r.currentPercent ?? 0} label={progressLabel(open)} className="mt-3" />
        <p className="min-h-[1lh] [overflow-wrap:anywhere] mt-2 text-xs text-fg-secondary" data-hub-position="">
          {positionText(r)}
          {last ? ` · last read ${last}` : ""}
        </p>
        {estimate && <EstimateLine estimate={estimate} lines="min-h-[2lh] [overflow-wrap:anywhere]" className="mt-1" />}
      </div>
      {/* Beside the cover the actions sit at the card's foot, so cards side
          by side keep them on one line when one title wraps longer */}
      <div className="col-span-2 mt-3 flex flex-wrap items-center gap-2 self-start @[280px]:col-span-1 @[280px]:col-start-2 @[280px]:self-end">
        {/* The book's eBook opens in the reader, which feeds this reading (SLN-683) */}
        {open.ebookId && (
          <ReaderEntryLink readerPath={`/reader/${open.ebookId}`} returnTo="/reading"
            className={buttonClass("secondary", "md")} data-hub-open-ebook={r.id}>
            Open eBook
          </ReaderEntryLink>
        )}
        <ReadingCardActions reading={refOf(open)} href={href} title={open.work.title} />
      </div>
    </article>
  );
}

/** A paused reading: one line with Resume */
export function PausedRow({ open, day }: { open: OpenReading; day: DayContext }) {
  const r = open.reading;
  const since = open.pausedAt ?? r.updatedAt;
  return (
    // The cover starts on the title's first line, as in Up next, however far the title wraps
    <li className="flex items-start gap-3 px-3 py-2" data-hub-paused={r.id} data-focus-row="">
      <Cover s3Key={open.cover} title={open.work.title} className="h-12 w-8" />
      <div className="min-w-0 flex-1">
        {/* The title names the row; Resume sits on its first line, as Up next's controls do */}
        <div className="flex gap-3 text-sm">
          <h3 className="min-w-0 flex-1">
            {/* The full title wraps inside the link and keeps its touch area */}
            <Link href={bookHref(open.work)} className="block text-fg-primary transition-colors hover:text-accent-primary touch-hit">
              <span className="block min-h-[1lh] [overflow-wrap:anywhere]">{open.work.title}</span>
            </Link>
          </h3>
          <CapAlignedControls height={32} coarseHeight={44}>
            <ResumeButton reading={refOf(open)} />
          </CapAlignedControls>
        </div>
        <p className="min-h-[1lh] [overflow-wrap:anywhere] text-xs text-fg-secondary">
          {[open.author, positionText(r), since ? `paused ${agoText(since, day)}` : null].filter(Boolean).join(" · ")}
        </p>
      </div>
    </li>
  );
}

/** A finished read, as the finished covers take it */
export function finishedItem(read: FinishedRead): FinishedItem {
  return {
    id: read.id,
    title: read.title,
    href: bookHref({ id: read.workId, slug: read.slug }),
    cover: read.cover,
    rating: read.rating,
    date: formatReadingDate(read.finishedOn, read.finishedPrecision),
  };
}

/** An open reading, as the dashboard's tile takes it */
export function tileItem(open: OpenReading, estimate?: ReadingEstimate): TileItem {
  return {
    estimate,
    reading: refOf(open),
    ebookId: open.ebookId,
    title: open.work.title,
    author: open.author,
    paused: open.reading.status === "paused",
    href: bookHref(open.work),
    cover: open.cover,
    percent: open.reading.currentPercent ?? 0,
    position: positionText(open.reading),
    progressLabel: progressLabel(open),
  };
}
