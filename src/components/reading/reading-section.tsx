"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { FadeImage } from "@/components/shared/fade-image";
import { BookText, Check, Headphones, MoreHorizontal, Pause, PenLine, Play, RotateCcw, Square, Tablet, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { SectionHeading } from "@/components/shared/section-heading";
import { ProgressBar } from "@/components/shared/progress-bar";
import { RatingStars } from "@/components/shared/rating";
import { Prose } from "@/components/shared/prose";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { ABANDON_REASON_LABELS, type AbandonReason, type ReadingFormat } from "@/lib/reading/constants";
import { formatReadingDate, formatReadingSpan } from "@/lib/reading/dates";
import { lastReadText, ordinalRead, positionText } from "@/lib/reading/labels";
import { formatRating } from "@/lib/utils/rating";
import { languageName } from "@/lib/utils/language";
import type { ReadingPageData, ReadingRow } from "./reading-client";
import { useReading } from "./reading-provider";
import { useOptionalTimer } from "./timer-provider";
import { SessionList } from "./session-list";
import { EstimateLine } from "./estimate-line";
import { clockText } from "@/lib/reading/timer";
import { mediaUrl } from "@/lib/s3/media-url";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";

const FORMAT_ICON: Record<ReadingFormat, typeof BookText> = { print: BookText, ebook: Tablet, audio: Headphones };
const FORMAT_LABEL: Record<ReadingFormat, string> = { print: "Print", ebook: "eBook", audio: "Audiobook" };

/** A read's rating: its own, else the book's when it is the book's only finished read */
export function readRating(row: ReadingRow, rows: ReadingRow[] | number, bookRating: number | null) {
  if (row.reading.rating != null) return Number(row.reading.rating);
  const finishedCount = typeof rows === "number" ? rows : rows.filter((r) => r.reading.status === "finished").length;
  return row.reading.status === "finished" && finishedCount === 1 ? bookRating : null;
}

function editionLine(row: ReadingRow, data: ReadingPageData) {
  const option = data.editions.find((e) => e.id === row.reading.editionId);
  if (!option) return row.edition?.title ?? "No edition";
  const translated = option.translators.length ? `tr. ${option.translators.join(", ")}` : null;
  return [option.title || null, languageName(option.language) ?? option.language, translated, option.pageCount ? `${option.pageCount} p.` : null]
    .filter(Boolean)
    .join(" · ");
}

function CurrentReading({ row }: { row: ReadingRow }) {
  const { data, run, open, toggleTimer } = useReading();
  const timer = useOptionalTimer();
  const timing = timer?.timer?.readingId === row.reading.id;
  const r = row.reading;
  const edition = data.editions.find((e) => e.id === r.editionId);
  const copy = edition?.copies.find((c) => c.id === r.instanceId);
  const position = positionText(r);
  const started = r.startedOn && r.startedPrecision !== "unknown"
    ? `Started ${formatReadingDate(r.startedOn, r.startedPrecision, { omitYear: r.startedPrecision === "day" && r.startedOn.slice(0, 4) === data.today.slice(0, 4) })}`
    : "Started, date unknown";
  const home = row.home?.name ? ` in ${row.home.name}` : "";
  const last = lastReadText(r.lastReadAt, data);
  return (
    <div className="mb-6 flex gap-4 rounded-sm border border-glass-border p-4" data-reading="current" data-focus-row="">
      <div className={`h-16 w-11 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary ${COVER_BLANK}`}>
        {edition?.cover ? (
          <FadeImage
            src={mediaUrl(edition.cover)}
            alt=""
            className="h-full w-full object-cover"
            fallback={<CoverLetter title={data.workTitle} />}
          />
        ) : (
          <CoverLetter title={data.workTitle} />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-sm text-fg-primary">{editionLine(row, data)}</p>
        <p className="truncate text-xs text-fg-secondary">{copy?.line ?? "No copy"}</p>
        <ProgressBar
          value={r.currentPercent ?? 0}
          label={`${Math.round(r.currentPercent ?? 0)} percent${r.currentPage != null && r.totalPages ? `, page ${r.currentPage} of ${r.totalPages}` : ""}`}
          tone="blue"
        />
        <p className="font-mono text-xs text-fg-secondary">
          {r.status === "paused" ? `Paused · ${position}` : position}
        </p>
        {data.estimates?.[r.id] && <EstimateLine estimate={data.estimates[r.id]} onAddLength={() => open({ kind: "edit", readingId: r.id })} />}
        <p className="text-xs text-fg-secondary">
          {started}
          {home}
          {last && ` · last read ${last}`}
        </p>
        {r.currentChapter && <p className="text-xs text-fg-secondary [overflow-wrap:anywhere]">Chapter {r.currentChapter}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="primary" onClick={() => run("progress", row)} className="pointer-coarse:h-11">
            Log progress
          </Button>
          {timer && (
            <Button size="sm" variant="ghost" onClick={toggleTimer} className="pointer-coarse:h-11" data-reading-timer="">
              {timing ? (
                <>
                  <Square aria-hidden strokeWidth={1.5} />
                  Stop timer <span className="tabular-nums text-fg-secondary">{clockText(timer.elapsed)}</span>
                </>
              ) : (
                <>
                  <Timer aria-hidden strokeWidth={1.5} />
                  Start timer
                </>
              )}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => run(r.status === "paused" ? "resume" : "pause", row)} className="pointer-coarse:h-11">
            {r.status === "paused" ? <Play aria-hidden strokeWidth={1.5} /> : <Pause aria-hidden strokeWidth={1.5} />}
            {r.status === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run("finish", row)} className="pointer-coarse:h-11">
            <Check aria-hidden strokeWidth={1.5} />
            Finish
          </Button>
          <RowMenu
            row={row}
            label="More reading actions"
            extra={
              <>
                <DropdownMenuItem onClick={() => open({ kind: "session", readingId: r.id })}>Add a session</DropdownMenuItem>
                <DropdownMenuItem onClick={() => run("abandon", row)}>Abandon</DropdownMenuItem>
              </>
            }
            onEdit={() => open({ kind: "edit", readingId: r.id })}
            onDelete={() => open({ kind: "delete", readingId: r.id })}
          />
        </div>
        <SessionList row={row} current />
      </div>
    </div>
  );
}

function RowMenu({
  row,
  label,
  extra,
  onEdit,
  onDelete,
}: {
  row: ReadingRow;
  label: string;
  extra?: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu
      label={label}
      align="end"
      trigger={
        <button
          type="button"
          aria-label={label}
          data-tooltip={label}
          data-reading-menu={row.reading.id}
          className="action-icon"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
        </button>
      }
    >
      {extra}
      <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="danger" onClick={onDelete}>
        Delete
      </DropdownMenuItem>
    </DropdownMenu>
  );
}

/**
 * A past read's review, three lines at first. "Show review" only when the
 * three lines hide some of it, as a toggle that names its state and what it
 * opens (SLN-1074)
 */
function Review({ html }: { html: string }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const prose = box.current?.firstElementChild;
    if (!(prose instanceof HTMLElement) || open) return;
    const measure = () => setCut(prose.scrollHeight > prose.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(prose);
    return () => observer.disconnect();
  }, [html, open]);
  return (
    <div>
      <div ref={box} id={id}>
        <Prose html={html} className={open ? "" : "line-clamp-3"} />
      </div>
      {(cut || open) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-xs text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline touch-hit"
        >
          {open ? "Hide review" : "Show review"}
        </button>
      )}
    </div>
  );
}

function HistoryRow({ row, previous }: { row: ReadingRow; previous: { editionId: string | null } | null }) {
  const { data, open } = useReading();
  const r = row.reading;
  const Icon = FORMAT_ICON[r.format as ReadingFormat] ?? BookText;
  const outcome =
    r.status === "abandoned"
      ? `Abandoned at ${r.unit === "pages" && r.currentPage != null ? `p. ${r.currentPage.toLocaleString("en")}` : `${Math.round(r.currentPercent ?? 0)}%`}${
          r.abandonReason ? ` · ${ABANDON_REASON_LABELS[r.abandonReason as AbandonReason]}` : ""
        }`
      : "Finished";
  const editionChanged = previous && previous.editionId !== r.editionId && r.editionId;
  const rating = readRating(row, data.summary.finishedCount, data.bookRating);
  return (
    <li className="border-t border-glass-border py-3 first:border-t-0" data-reading="history" data-focus-row="">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-primary">
            <span>{ordinalRead(row.ordinal)}</span>
            <span className="text-fg-secondary">{formatReadingSpan(r, data.today)}</span>
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-secondary">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-label={FORMAT_LABEL[r.format as ReadingFormat] ?? "Print"} />
            <span>{outcome}</span>
            {editionChanged && <span className="truncate">· {editionLine(row, data)}</span>}
          </p>
          {rating != null && <RatingStars value={rating} size={12} />}
          {row.sessionCount > 0 && <SessionList row={row} current={false} />}
          {r.reviewHtml && <Review html={r.reviewHtml} />}
        </div>
        {/* On the cap-height center of the row's first line */}
        <CapAlignedControls height={32} coarseHeight={44} className="text-sm">
          <RowMenu
            row={row}
            label={`More actions for the ${ordinalRead(row.ordinal)}`}
            onEdit={() => open({ kind: "edit", readingId: r.id })}
            onDelete={() => open({ kind: "delete", readingId: r.id })}
          />
        </CapAlignedControls>
      </div>
    </li>
  );
}

/** The book page's Reading section; nothing while the book has no readings */
export function ReadingSection() {
  const { data, openRow, run } = useReading();
  if (!data.summary.readingCount) return null;
  const history = data.rows.filter((r) => r !== openRow);
  const rated = data.summary.ratings.preview;
  return (
    <section className="mb-8 scroll-mt-16" id="reading" data-navigation-focus="" tabIndex={-1}>
      <SectionHeading
        title="Reading"
        count={data.summary.readingCount}
        action={
          <Button variant="ghost" size="sm" onClick={() => run(openRow ? "progress" : "reread")} className="pointer-coarse:h-11">
            {openRow ? <PenLine aria-hidden strokeWidth={1.5} /> : <RotateCcw aria-hidden strokeWidth={1.5} />}
            {openRow ? "Log progress" : "Re-read"}
          </Button>
        }
      />
      {/* One list for the focus: a deleted reading hands it to the next one
          (FocusKeeper), each by its More menu */}
      <div data-focus-list="book-readings">
        {openRow && <CurrentReading row={openRow} />}
        {history.length > 0 && (
          <ol className="max-w-2xl">
            {history.map((row) => (
              <HistoryRow key={row.reading.id} row={row} previous={row.previousClosed} />
            ))}
          </ol>
        )}
      </div>
      {data.history.hasMore && <Link href={`/reading/journal?work=${data.workId}`} className="mt-3 inline-flex text-xs text-fg-secondary hover:text-fg-primary touch-hit">View all {data.history.closedCount} past readings</Link>}
      {data.summary.ratings.count >= 2 && (
        <p className="mt-3 text-xs text-fg-secondary">
          {data.summary.ratings.hasMore ? "Latest ratings" : "Your ratings"}: {rated.map((r) => `${formatRating(r.rating)}${r.year ? ` (${r.year})` : ""}`).join(", ")}
        </p>
      )}
    </section>
  );
}
