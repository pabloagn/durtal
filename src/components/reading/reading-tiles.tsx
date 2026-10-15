"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, BookText, Headphones, Tablet } from "lucide-react";
import { SectionHeading } from "@/components/shared/section-heading";
import { CardHeading } from "@/components/shared/card-heading";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { ProgressBar } from "@/components/shared/progress-bar";
import { RatingStars } from "@/components/shared/rating";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { Badge } from "@/components/ui/badge";
import type { ReadingFormat } from "@/lib/reading/constants";
import type { ReadingEstimate } from "@/lib/reading/pace";
import { EstimateLine } from "./estimate-line";
import { JournalRowMenu, LogButton } from "./hub-actions";
import { GoalLine } from "./goal-card";
import type { GoalProgress } from "@/lib/actions/reading-goals";
import type { ReadingRef } from "./reading-dialogs-provider";
import { mediaUrl } from "@/lib/s3/media-url";

/*
 * The reading lists that repeat (SLN-448): the dashboard's tiles, the finished
 * covers and the journal's rows. Client components with small props, so a
 * page sends each item's few fields once instead of its whole element tree:
 * "/" stays within its 300 KB budget and a journal page of 48 rows within its.
 */

/** A book's cover, or a book icon on the blank thumb; `icon={false}` leaves a tiny thumb blank; `eager` loads it at once (a page meant for print) */
export function Cover({ s3Key, className, icon = true, eager = false }: { s3Key: string | null; className: string; icon?: boolean; eager?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary ${className}`}>
      {s3Key ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl(s3Key)} alt="" loading={eager ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover" />
      ) : (
        icon && <BookOpen className="h-4 w-4 text-fg-muted" strokeWidth={1.5} aria-hidden data-decorative="" />
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
          <span className="block min-h-[1lh] [overflow-wrap:anywhere] mt-2 text-sm text-fg-primary transition-colors group-hover:text-accent-primary">{read.title}</span>
          {/* Stars, then the date: a narrow cover (six to a row) has no room for both on one line */}
          <span className="mt-1 flex h-5 items-center">
            <RatingStars value={read.rating} />
          </span>
          <span className="block min-h-[1lh] [overflow-wrap:anywhere] font-mono text-micro text-fg-secondary">{read.date}</span>
        </Link>
      ))}
    </div>
  );
}

export interface TileItem {
  ebookId?: string | null;
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
  author?: string | null;
  paused?: boolean;
}

function SectionLink({ href }: { href: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit">
      View all
      <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
    </Link>
  );
}

/**
 * The dashboard's reading, under its "Reading" heading: up to three books
 * open, each with its cover large enough to know it by, then this year's goal
 * and up to four finished covers. The page leaves the section out when all
 * three are empty.
 */
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
  return (
    <>
      {tiles.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => (
            <article key={tile.reading.readingId} className="flex gap-4 rounded-sm border border-glass-border bg-bg-secondary p-4" data-dashboard-reading={tile.reading.readingId}>
              <Cover s3Key={tile.cover} className="aspect-[2/3] w-20 self-start" />
              <div className="flex min-w-0 flex-1 flex-col">
                {/* The full title wraps; the heading names the card */}
                <CardHeading
                  title={
                    <Link href={tile.href} className="transition-colors hover:text-accent-primary">
                      {tile.title}
                    </Link>
                  }
                  subtitle={tile.author ?? ""}
                />
                <ProgressBar value={tile.percent} label={tile.progressLabel} className="mt-3" />
                <p className="mt-2 min-h-[1lh] [overflow-wrap:anywhere] text-xs text-fg-secondary">
                  {tile.paused ? `Paused · ${tile.position}` : tile.position}
                </p>
                {tile.estimate && <EstimateLine estimate={tile.estimate} lines="min-h-[2lh] [overflow-wrap:anywhere]" className="mt-1" />}
                {/* The actions at the foot of the card, starting on the text edge */}
                <div className="mt-auto flex flex-wrap items-center gap-x-4 pt-2 text-xs">
                  <span className="-ml-2.5">
                    <LogButton reading={tile.reading} title={tile.title} />
                  </span>
                  {tile.ebookId && (
                    <ReaderEntryLink readerPath={`/reader/${tile.ebookId}`} returnTo="/" className="text-command">
                      Open eBook
                    </ReaderEntryLink>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {goal && (
        <div className={tiles.length > 0 ? "mt-4" : ""}>
          <GoalLine goal={goal.progress} serverToday={goal.serverToday} dayStartHour={goal.dayStartHour} />
        </div>
      )}
      {finished.length > 0 && (
        <div className={tiles.length > 0 || goal ? "mt-10" : ""}>
          <SectionHeading as="h3" title="Recently finished" action={<SectionLink href="/reading/journal" />} />
          <FinishedCovers reads={finished} className="catalogue-grid" />
        </div>
      )}
    </>
  );
}

const FORMAT_ICON: Record<ReadingFormat, typeof BookText> = { print: BookText, ebook: Tablet, audio: Headphones };
const FORMAT_LABEL: Record<ReadingFormat, string> = { print: "Print", ebook: "eBook", audio: "Audiobook" };

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
          // The cover starts on the title's first line, as in Up next, however far the title wraps
          <li key={row.reading.readingId} className="flex items-start gap-3 px-3 py-2" data-journal-row={row.reading.readingId}>
            <Cover s3Key={row.cover} className="h-12 w-8" />
            <div className="min-w-0 flex-1">
              {/* The title names the row; its marks and menu sit on its first line, as in Up next */}
              <div className="flex gap-3 text-sm">
                <h3 className="min-w-0 flex-1">
                  {/* The full title wraps inside the link and keeps its touch area */}
                  <Link href={row.href} className="block text-fg-primary transition-colors hover:text-accent-primary touch-hit">
                    <span className="block min-h-[1lh] [overflow-wrap:anywhere]">{row.title}</span>
                  </Link>
                </h3>
                <CapAlignedControls height={32} coarseHeight={44}>
                  <span className="flex items-center gap-3">
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
                  </span>
                </CapAlignedControls>
              </div>
              <p className="min-h-[1lh] [overflow-wrap:anywhere] text-xs text-fg-secondary">{row.line}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
