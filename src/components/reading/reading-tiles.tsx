"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SpriteIcon, type SpriteIconName } from "@/components/ui/sprite-icon";
import { SectionHeading } from "@/components/shared/section-heading";
import { CardHeading } from "@/components/shared/card-heading";
import { WORK_CARD, WORK_CARD_BODY } from "@/components/shared/work-card";
import { fullRowAttributes } from "@/components/shared/phone-pair-grid";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { ProgressBar } from "@/components/shared/progress-bar";
import { RatingStars } from "@/components/shared/rating";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { Badge } from "@/components/ui/badge";
import type { ReadingFormat } from "@/lib/reading/constants";
import type { ReadingEstimate } from "@/lib/reading/pace";
import { EstimateLine } from "./estimate-line";
import { JournalRowMenu, LogButton, ResumeButton } from "./hub-actions";
import { GoalLine } from "./goal-card";
import type { GoalProgress } from "@/lib/actions/reading-goals";
import type { ReadingRef } from "./reading-dialogs-provider";
import { mediaUrl } from "@/lib/s3/media-url";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";
import { FadeImage } from "@/components/shared/fade-image";

/*
 * The reading lists that repeat (SLN-448): the dashboard's tiles, the finished
 * covers and the journal's rows. Client components with small props, so a
 * page sends each item's few fields once instead of its whole element tree:
 * "/" stays within its 300 KB budget and a journal page of 48 rows within its.
 */

/**
 * A book's cover, or on the blank the title's letter, as on every other cover
 * (`CoverLetter`); with no `title` the blank stays empty (the timer chip's
 * tiny thumb). `eager` loads it at once (a page meant for print)
 */
export function Cover({ s3Key, className, title, eager = false }: { s3Key: string | null; className: string; title?: string; eager?: boolean }) {
  return (
    <span className={`${COVER_BLANK} shrink-0 overflow-hidden rounded-sm bg-bg-tertiary ${className}`}>
      {s3Key ? (
        <FadeImage
          src={mediaUrl(s3Key)}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className="h-full w-full object-cover"
          // A cover that fails shows the letter, or with no title the bare blank
          fallback={title ? <CoverLetter title={title} /> : null}
        />
      ) : (
        title && <CoverLetter title={title} />
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

/**
 * Finished reads as the house's work cards (SLN-769): the cover, the title in
 * `CardHeading`, then the read's rating and its finish date at the card's
 * foot. The grid sets the width (`catalogue-grid`: 208px readable minimum,
 * two a row on a phone), and the row ends full (`full-rows`, SLN-774)
 */
export function FinishedCovers({ reads, className }: { reads: FinishedItem[]; className: string }) {
  return (
    <div className={`${className} full-rows`} {...fullRowAttributes(reads.length)}>
      {reads.map((read) => (
        <article key={read.id} className={WORK_CARD} data-hub-finished={read.id}>
          <Link href={read.href} aria-label={read.title} className="block cover-shadow">
            <Cover s3Key={read.cover} title={read.title} className="aspect-[2/3] w-full" />
          </Link>
          {/* As the library's cards: the link covers the text, so the whole card is the target */}
          <div className="relative flex flex-1 flex-col">
            <Link href={read.href} aria-label={read.title} tabIndex={-1} className="absolute inset-0 z-10" />
            <div className={WORK_CARD_BODY}>
              <CardHeading title={read.title} />
              {/* Stars, then the date; on a narrow card the date takes its own line */}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <RatingStars value={read.rating} />
                <span className="font-mono text-micro text-fg-secondary [overflow-wrap:anywhere]">{read.date}</span>
              </div>
            </div>
          </div>
        </article>
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tiles.map((tile, i) => (
            <article
              key={tile.reading.readingId}
              // Two a row below 1280 leave a third card alone under the first:
              // the row ends full, and the section's own link leads to the rest
              // (SLN-891). One a row on a phone shows all three.
              className={`@container flex gap-3 rounded-sm border border-glass-border bg-bg-secondary p-3 @xs:gap-4 @xs:p-4${i === 2 ? " md:max-xl:hidden" : ""}`}
              data-dashboard-reading={tile.reading.readingId}
            >
              {/* A narrow card (a 320px phone) keeps its text column for the estimate */}
              <Cover s3Key={tile.cover} title={tile.title} className="aspect-[2/3] w-12 self-start @xs:w-20" />
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
          {/* Two covers a row on a phone, as the dashboard's other cover grids */}
          <div className="@container">
            <FinishedCovers reads={finished} className="catalogue-grid catalogue-density-compact" />
          </div>
        </div>
      )}
    </>
  );
}

// Drawn from the sprite: a journal page repeats them in every row (SLN-809)
const FORMAT_ICON: Record<ReadingFormat, SpriteIconName> = { print: "book-text", ebook: "tablet", audio: "headphones" };
const FORMAT_LABEL: Record<ReadingFormat, string> = { print: "Print", ebook: "eBook", audio: "Audiobook" };

export interface JournalItem {
  status?: "reading" | "paused" | "finished" | "abandoned";
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
        return (
          // The cover starts on the title's first line, as in Up next, however far the title wraps
          <li key={row.reading.readingId} className="flex items-start gap-3 px-3 py-2" data-journal-row={row.reading.readingId}>
            <Cover s3Key={row.cover} title={row.title} className="h-12 w-8" />
            <div className="@container min-w-0 flex-1">
              {/*
               * The title names the row; its marks and menu sit on its first line, as in Up next.
               * Where they would leave the title under 9rem (a phone; sooner with Log or Resume),
               * they go under it instead, clear of the lines around them (SLN-893)
               */}
              <div className={`flex gap-3 text-sm ${row.status === "reading" || row.status === "paused" ? "@max-[25rem]:flex-col" : "@max-[17.5rem]:flex-col"}`}>
                <h3 className="min-w-0 flex-1">
                  {/* The full title wraps inside the link and keeps its touch area */}
                  <Link href={row.href} className="block text-fg-primary transition-colors hover:text-accent-primary touch-hit">
                    <span className="block min-h-[1lh] [overflow-wrap:anywhere]">{row.title}</span>
                  </Link>
                </h3>
                <CapAlignedControls
                  height={32}
                  coarseHeight={44}
                  className={row.status === "reading" || row.status === "paused" ? "@max-[25rem]:my-3.5" : "@max-[17.5rem]:my-3.5"}
                >
                  <span className="flex items-center gap-3">
                    {row.translated && (
                      <span className="hidden sm:inline-flex">
                        <Badge variant="blue">{row.translated}</Badge>
                      </span>
                    )}
                    <span className="hidden text-fg-secondary sm:inline-flex" aria-label={FORMAT_LABEL[row.format]} data-tooltip={FORMAT_LABEL[row.format]} role="img">
                      <SpriteIcon name={FORMAT_ICON[row.format]} className="h-4 w-4" />
                    </span>
                    <RatingStars value={row.rating} />
                    {row.status === "reading" && <LogButton reading={row.reading} title={row.title} />}
                    {row.status === "paused" && <ResumeButton reading={row.reading} />}
                    <JournalRowMenu reading={row.reading} title={row.title} />
                  </span>
                </CapAlignedControls>
              </div>
              {/* Each "·" stays with the item before it, so no line starts with one */}
              <p className="min-h-[1lh] [overflow-wrap:anywhere] text-xs text-fg-secondary">{row.line.replaceAll(" · ", "\u00a0· ")}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
