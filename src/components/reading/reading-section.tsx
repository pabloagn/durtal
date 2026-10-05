"use client";

import { useState } from "react";
import { BookText, Headphones, MoreHorizontal, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { SectionHeading } from "@/components/shared/section-heading";
import { ProgressBar } from "@/components/shared/progress-bar";
import { RatingStars } from "@/components/shared/rating";
import { Prose } from "@/components/shared/prose";
import { CapAligned } from "@/components/shared/cap-aligned";
import { ABANDON_REASON_LABELS, type AbandonReason, type ReadingFormat } from "@/lib/reading/constants";
import { formatReadingDate, formatReadingSpan } from "@/lib/reading/dates";
import { lastReadText, ordinalRead, positionText } from "@/lib/reading/labels";
import { formatRating } from "@/lib/utils/rating";
import { languageName } from "@/lib/utils/language";
import type { ReadingPageData, ReadingRow } from "./reading-client";
import { useReading } from "./reading-provider";
import { useOptionalTimer } from "./timer-provider";
import { clockText } from "@/lib/reading/timer";

const FORMAT_ICON: Record<ReadingFormat, typeof BookText> = { print: BookText, ebook: Tablet, audio: Headphones };
const FORMAT_LABEL: Record<ReadingFormat, string> = { print: "Print", ebook: "E-book", audio: "Audiobook" };

/** A read's rating: its own, else the book's when it is the book's only finished read */
export function readRating(row: ReadingRow, rows: ReadingRow[], bookRating: number | null) {
  if (row.reading.rating != null) return Number(row.reading.rating);
  const finished = rows.filter((r) => r.reading.status === "finished");
  return row.reading.status === "finished" && finished.length === 1 ? bookRating : null;
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
    <div className="mb-6 flex gap-4 rounded-sm border border-glass-border p-4" data-reading="current">
      <div className="h-16 w-11 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
        {edition?.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/s3/read?key=${encodeURIComponent(edition.cover)}`} alt="" className="h-full w-full object-cover" />
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
        <p className="text-xs text-fg-secondary">
          {started}
          {home}
          {last && ` · last read ${last}`}
        </p>
        {r.currentChapter && <p className="text-xs text-fg-secondary">Chapter {r.currentChapter}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="primary" onClick={() => run("progress", row)} className="pointer-coarse:h-11">
            Log progress
          </Button>
          {timer && (
            <Button size="sm" variant="ghost" onClick={toggleTimer} className="pointer-coarse:h-11" data-reading-timer="">
              {timing ? (
                <>
                  Stop timer <span className="tabular-nums text-fg-secondary">{clockText(timer.elapsed)}</span>
                </>
              ) : (
                "Start timer"
              )}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => run(r.status === "paused" ? "resume" : "pause", row)} className="pointer-coarse:h-11">
            {r.status === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run("finish", row)} className="pointer-coarse:h-11">
            Finish
          </Button>
          <RowMenu
            row={row}
            label="More reading actions"
            extra={
              <DropdownMenuItem onClick={() => run("abandon", row)}>Abandon</DropdownMenuItem>
            }
            onEdit={() => open({ kind: "edit", readingId: r.id })}
            onDelete={() => open({ kind: "delete", readingId: r.id })}
          />
        </div>
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
          className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:h-11 pointer-coarse:w-11"
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

function HistoryRow({ row, previous }: { row: ReadingRow; previous: ReadingRow | null }) {
  const { data, open } = useReading();
  const [showReview, setShowReview] = useState(false);
  const r = row.reading;
  const Icon = FORMAT_ICON[r.format as ReadingFormat] ?? BookText;
  const outcome =
    r.status === "abandoned"
      ? `Abandoned at ${r.unit === "pages" && r.currentPage != null ? `p. ${r.currentPage}` : `${Math.round(r.currentPercent ?? 0)}%`}${
          r.abandonReason ? ` · ${ABANDON_REASON_LABELS[r.abandonReason as AbandonReason]}` : ""
        }`
      : "Finished";
  const editionChanged = previous && previous.reading.editionId !== r.editionId && r.editionId;
  const rating = readRating(row, data.rows, data.bookRating);
  return (
    <li className="border-t border-glass-border py-3 first:border-t-0" data-reading="history">
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
          {r.reviewHtml && (
            <div>
              <Prose html={r.reviewHtml} className={showReview ? "" : "line-clamp-3"} />
              <button
                type="button"
                onClick={() => setShowReview((v) => !v)}
                className="mt-1 text-xs text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline"
              >
                {showReview ? "Hide review" : "Show review"}
              </button>
            </div>
          )}
        </div>
        {/* On the cap-height center of the row's first line */}
        <CapAligned height={32} coarseHeight={44} className="text-sm">
          <RowMenu
            row={row}
            label={`${ordinalRead(row.ordinal)}: actions`}
            onEdit={() => open({ kind: "edit", readingId: r.id })}
            onDelete={() => open({ kind: "delete", readingId: r.id })}
          />
        </CapAligned>
      </div>
    </li>
  );
}

/** The book page's Reading section; nothing while the book has no readings */
export function ReadingSection() {
  const { data, openRow, run } = useReading();
  if (!data.rows.length) return null;
  const history = data.rows.filter((r) => r !== openRow);
  const rated = data.rows
    .filter((r) => r.reading.status === "finished")
    .map((r) => ({ rating: readRating(r, data.rows, data.bookRating), year: r.reading.finishedOn?.slice(0, 4) ?? null, ordinal: r.ordinal }))
    .filter((r) => r.rating != null)
    .sort((a, b) => a.ordinal - b.ordinal);
  return (
    <section className="mb-8 scroll-mt-16" id="reading">
      <SectionHeading
        title="Reading"
        count={data.rows.length}
        action={
          <Button variant="ghost" size="sm" onClick={() => run(openRow ? "progress" : "reread")} className="pointer-coarse:h-11">
            {openRow ? "Log progress" : "Re-read"}
          </Button>
        }
      />
      {openRow && <CurrentReading row={openRow} />}
      {history.length > 0 && (
        <ol className="max-w-2xl">
          {history.map((row, i) => (
            <HistoryRow key={row.reading.id} row={row} previous={history[i + 1] ?? null} />
          ))}
        </ol>
      )}
      {rated.length >= 2 && (
        <p className="mt-3 text-xs text-fg-secondary">
          Your ratings: {rated.map((r) => `${formatRating(r.rating)}${r.year ? ` (${r.year})` : ""}`).join(", ")}
        </p>
      )}
    </section>
  );
}
