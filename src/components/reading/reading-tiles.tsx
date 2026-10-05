"use client";

import Link from "next/link";
import { ArrowRight, BookCheck, BookMarked, BookOpen, BookText, Headphones, Tablet } from "lucide-react";
import { SectionHeading } from "@/components/shared/section-heading";
import { ProgressBar } from "@/components/shared/progress-bar";
import { RatingStars } from "@/components/shared/rating";
import { Badge } from "@/components/ui/badge";
import type { ReadingFormat } from "@/lib/reading/constants";
import type { ReadingEstimate } from "@/lib/reading/pace";
import { EstimateLine } from "./estimate-line";
import { JournalRowMenu, LogButton } from "./hub-actions";
import { GoalLine } from "./goal-card";
import type { GoalProgress } from "@/lib/actions/reading-goals";
import type { ReadingRef } from "./reading-dialogs-provider";

/*
 * The reading lists that repeat (SLN-448): the dashboard's tiles, the finished
 * covers and the journal's rows. Client components with small props, so a
 * page sends each item's few fields once instead of its whole element tree:
 * "/" stays within its 300 KB budget and a journal page of 48 rows within its.
 */

/** A book's cover, or a book icon on the blank thumb; `icon={false}` leaves a tiny thumb blank */
export function Cover({ s3Key, className, icon = true }: { s3Key: string | null; className: string; icon?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary ${className}`}>
      {s3Key ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/s3/read?key=${encodeURIComponent(s3Key)}`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        icon && <BookOpen className="h-4 w-4 text-fg-muted" strokeWidth={1.5} aria-hidden />
      )}
    </span>
  );
}

export interface FinishedItem {
  id: string;
  title: string;
  href: string;
  cover: string | null;
  rating: number | null;
  /** The finish date at its precision: "14 Apr 2019", "Apr 2019", "2019" */
  date: string;
}

/** Finished reads: cover, title, the read's rating and its finish date */
export function FinishedCovers({ reads, className }: { reads: FinishedItem[]; className: string }) {
  return (
    <div className={className}>
      {reads.map((read) => (
        <Link key={read.id} href={read.href} className="group block min-w-0" data-hub-finished={read.id}>
          <Cover s3Key={read.cover} className="aspect-[2/3] w-full" />
          <span className="lines-1 mt-2 block text-sm text-fg-primary transition-colors group-hover:text-accent-rose-text">{read.title}</span>
          {/* Stars, then the date: a narrow cover (six to a row) has no room for both on one line */}
          <span className="mt-1 flex h-5 items-center">
            <RatingStars value={read.rating} />
          </span>
          <span className="lines-1 block font-mono text-micro text-fg-secondary">{read.date}</span>
        </Link>
      ))}
    </div>
  );
}

export interface TileItem {
  reading: ReadingRef;
  title: string;
  href: string;
  cover: string | null;
  percent: number;
  /** "p. 212 of 480 · 44%", "44%", "3:12 of 9:40" */
  position: string;
  /** What a screen reader hears for the bar */
  progressLabel: string;
  /** Time left and the finish date (SLN-451) */
  estimate?: ReadingEstimate;
}

function SectionLink({ href }: { href: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-fg-secondary transition-colors hover:text-fg-primary">
      View all
      <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
    </Link>
  );
}

/** The dashboard's reading: up to three tiles with Log, up to four finished covers; each left out when empty */
export function DashboardReading({
  tiles,
  finished,
  goal,
}: {
  tiles: TileItem[];
  finished: FinishedItem[];
  /** This year's first goal, for one line under the tiles (SLN-455) */
  goal?: { progress: GoalProgress; serverToday: string; dayStartHour: number } | null;
}) {
  const goalLine = goal ? <GoalLine goal={goal.progress} serverToday={goal.serverToday} dayStartHour={goal.dayStartHour} /> : null;
  return (
    <>
      {tiles.length === 0 && goalLine && (
        <section className="mt-12">
          <SectionHeading title="Reading" icon={BookMarked} action={<SectionLink href="/reading" />} />
          {goalLine}
        </section>
      )}
      {tiles.length > 0 && (
        <section className="mt-12">
          <SectionHeading title="Currently reading" icon={BookMarked} action={<SectionLink href="/reading" />} />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tiles.map((tile) => (
              <div key={tile.reading.readingId} className="flex gap-3 rounded-sm border border-glass-border bg-bg-secondary p-3" data-dashboard-reading={tile.reading.readingId}>
                <Cover s3Key={tile.cover} className="h-16 w-11" />
                <div className="min-w-0 flex-1">
                  <Link href={tile.href} className="lines-1 block text-sm text-fg-primary transition-colors hover:text-accent-rose-text">
                    {tile.title}
                  </Link>
                  <ProgressBar value={tile.percent} label={tile.progressLabel} className="mt-2" />
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="lines-1 text-xs text-fg-secondary">{tile.position}</span>
                    <LogButton reading={tile.reading} title={tile.title} />
                  </div>
                  {tile.estimate && <EstimateLine estimate={tile.estimate} lines="lines-2" className="mt-1" />}
                </div>
              </div>
            ))}
          </div>
          {goalLine && <div className="mt-3">{goalLine}</div>}
        </section>
      )}
      {finished.length > 0 && (
        <section className="mt-12">
          <SectionHeading title="Recently finished" icon={BookCheck} action={<SectionLink href="/reading/journal" />} />
          <FinishedCovers reads={finished} className="grid grid-cols-2 gap-4 sm:grid-cols-4" />
        </section>
      )}
    </>
  );
}

const FORMAT_ICON: Record<ReadingFormat, typeof BookText> = { print: BookText, ebook: Tablet, audio: Headphones };
const FORMAT_LABEL: Record<ReadingFormat, string> = { print: "Print", ebook: "E-book", audio: "Audiobook" };

export interface JournalItem {
  reading: ReadingRef;
  title: string;
  href: string;
  cover: string | null;
  /** "Author · 3 to 14 Apr 2019 · Finished · re-read" */
  line: string;
  format: ReadingFormat;
  /** The edition's language when it is not the original's */
  translated: string | null;
  rating: number | null;
}

/** One group of the journal's rows */
export function JournalRows({ rows }: { rows: JournalItem[] }) {
  return (
    <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary">
      {rows.map((row) => {
        const Icon = FORMAT_ICON[row.format];
        return (
          <li key={row.reading.readingId} className="flex items-center gap-3 px-3 py-2" data-journal-row={row.reading.readingId}>
            <Cover s3Key={row.cover} className="h-12 w-8" />
            <div className="min-w-0 flex-1">
              <Link href={row.href} className="lines-1 block text-sm text-fg-primary transition-colors hover:text-accent-rose-text">
                {row.title}
              </Link>
              <p className="lines-1 text-xs text-fg-secondary">{row.line}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {row.translated && (
                <span className="hidden sm:inline-flex">
                  <Badge variant="blue">{row.translated}</Badge>
                </span>
              )}
              <span className="hidden text-fg-secondary sm:inline-flex" aria-label={FORMAT_LABEL[row.format]} data-tooltip={FORMAT_LABEL[row.format]} role="img">
                <Icon className="h-4 w-4" strokeWidth={1.5} />
              </span>
              <RatingStars value={row.rating} />
              <JournalRowMenu reading={row.reading} title={row.title} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
