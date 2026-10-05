import Link from "next/link";
import { CardHeading } from "@/components/shared/card-heading";
import { ProgressBar } from "@/components/shared/progress-bar";
import { formatReadingDate } from "@/lib/reading/dates";
import { agoText, lastReadText, positionText, type DayContext } from "@/lib/reading/labels";
import type { getOpenReadings } from "@/lib/actions/reading";
import type { FinishedRead } from "@/lib/reading/journal";
import { ReadingCardActions, ResumeButton } from "./hub-actions";
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
export function CurrentReadingCard({ open, day }: { open: OpenReading; day: DayContext }) {
  const r = open.reading;
  const href = bookHref(open.work);
  const last = lastReadText(r.lastReadAt, day);
  return (
    <article className="flex gap-4 rounded-sm border border-glass-border bg-bg-secondary p-4" data-hub-card={r.id}>
      <Cover s3Key={open.cover} className="h-24 w-16" />
      <div className="min-w-0 flex-1">
        <CardHeading
          title={
            <Link href={href} className="transition-colors hover:text-accent-rose-text">
              {open.work.title}
            </Link>
          }
          subtitle={open.author ?? ""}
        />
        <ProgressBar value={r.currentPercent ?? 0} label={progressLabel(open)} className="mt-3" />
        <p className="lines-1 mt-2 text-xs text-fg-secondary" data-hub-position="">
          {positionText(r)}
          {last ? ` · last read ${last}` : ""}
        </p>
        <div className="mt-3">
          <ReadingCardActions reading={refOf(open)} href={href} title={open.work.title} />
        </div>
      </div>
    </article>
  );
}

/** A paused reading: one line with Resume */
export function PausedRow({ open, day }: { open: OpenReading; day: DayContext }) {
  const r = open.reading;
  const since = open.pausedAt ?? r.updatedAt;
  return (
    <li className="flex items-center gap-3 px-3 py-2" data-hub-paused={r.id}>
      <Cover s3Key={open.cover} className="h-12 w-8" />
      <div className="min-w-0 flex-1">
        <Link href={bookHref(open.work)} className="lines-1 block text-sm text-fg-primary transition-colors hover:text-accent-rose-text">
          {open.work.title}
        </Link>
        <p className="lines-1 text-xs text-fg-secondary">
          {[open.author, positionText(r), since ? `paused ${agoText(since, day)}` : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      <ResumeButton reading={refOf(open)} />
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
export function tileItem(open: OpenReading): TileItem {
  return {
    reading: refOf(open),
    title: open.work.title,
    href: bookHref(open.work),
    cover: open.cover,
    percent: open.reading.currentPercent ?? 0,
    position: positionText(open.reading),
    progressLabel: progressLabel(open),
  };
}
