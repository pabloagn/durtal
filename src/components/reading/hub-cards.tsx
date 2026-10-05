import Link from "next/link";
import { BookOpen } from "lucide-react";
import { CardHeading } from "@/components/shared/card-heading";
import { ProgressBar } from "@/components/shared/progress-bar";
import { RatingStars } from "@/components/shared/rating";
import { formatReadingDate } from "@/lib/reading/dates";
import { agoText, lastReadText, positionText, type DayContext } from "@/lib/reading/labels";
import type { getOpenReadings } from "@/lib/actions/reading";
import type { FinishedRead } from "@/lib/reading/journal";
import { LogButton, ReadingCardActions, ResumeButton } from "./hub-actions";

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

export function Cover({ s3Key, className }: { s3Key: string | null; className: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary ${className}`}>
      {s3Key ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/s3/read?key=${encodeURIComponent(s3Key)}`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <BookOpen className="h-4 w-4 text-fg-muted" strokeWidth={1.5} aria-hidden />
      )}
    </span>
  );
}

/** A reading in progress: cover, title, author, progress, last read, Log progress and its menu */
export function CurrentReadingCard({ open, day }: { open: OpenReading; day: DayContext }) {
  const r = open.reading;
  const href = bookHref(open.work);
  const last = lastReadText(r.lastReadAt, day);
  return (
    <article className="flex gap-4 rounded-sm border border-glass-border bg-bg-secondary p-4" data-hub-card={r.id}>
      <Link href={href} tabIndex={-1} aria-hidden className="self-start">
        <Cover s3Key={open.cover} className="h-24 w-16" />
      </Link>
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

/** A finished read: cover, title, the read's rating and its finish date */
export function FinishedCover({ read }: { read: FinishedRead }) {
  return (
    <Link href={bookHref({ id: read.workId, slug: read.slug })} className="group block min-w-0" data-hub-finished={read.id}>
      <Cover s3Key={read.cover} className="aspect-[2/3] w-full" />
      <span className="lines-1 mt-2 block text-sm text-fg-primary transition-colors group-hover:text-accent-rose-text">{read.title}</span>
      <span className="mt-1 flex h-5 items-center justify-between gap-2">
        <RatingStars value={read.rating} />
        <span className="shrink-0 font-mono text-micro text-fg-secondary">{formatReadingDate(read.finishedOn, read.finishedPrecision)}</span>
      </span>
    </Link>
  );
}

/** The dashboard's light tile: cover, title, progress, position, Log */
export function DashboardReadingTile({ open }: { open: OpenReading }) {
  const r = open.reading;
  return (
    <div className="flex gap-3 rounded-sm border border-glass-border bg-bg-secondary p-3" data-dashboard-reading={r.id}>
      <Cover s3Key={open.cover} className="h-16 w-11" />
      <div className="min-w-0 flex-1">
        <Link href={bookHref(open.work)} className="lines-1 block text-sm text-fg-primary transition-colors hover:text-accent-rose-text">
          {open.work.title}
        </Link>
        <ProgressBar value={r.currentPercent ?? 0} label={progressLabel(open)} className="mt-2" />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="lines-1 text-xs text-fg-secondary">{positionText(r)}</span>
          <LogButton reading={refOf(open)} title={open.work.title} />
        </div>
      </div>
    </div>
  );
}
