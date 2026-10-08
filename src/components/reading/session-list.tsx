"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Download, MoreHorizontal, PenLine, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";
import { deleteSession, getReadingSessions, restoreSession, type SessionRow } from "@/lib/actions/reading";
import type { ReadingFormat, SessionSource } from "@/lib/reading/constants";
import { formatReadingDate } from "@/lib/reading/dates";
import { durationWords, elapsedSeconds, wallTime, zoneCity } from "@/lib/reading/timer";
import { browserZone, showError, undoToast, type ReadingRow } from "./reading-client";
import { formatMinutes } from "@/lib/reading/positions";
import { useReading } from "./reading-provider";
import { useOptionalTimer } from "./timer-provider";

/*
 * A reading's sessions (SLN-451), newest first in the session order. They
 * load when the list opens, so the book page stays as light as it was. The
 * running timer is the top row, without Edit or Delete: the chip controls it.
 */

const SOURCE: Record<SessionSource, { icon: typeof Timer; label: string }> = {
  manual: { icon: PenLine, label: "Logged by hand" },
  timer: { icon: Timer, label: "Timed" },
  reader: { icon: BookOpen, label: "From the e-book reader" },
  import: { icon: Download, label: "Imported" },
};
const MIN_PACE_SECONDS = 5 * 60;
const FORMAT_LABEL: Record<ReadingFormat, string> = { print: "Print", ebook: "eBook", audio: "Audiobook" };

/** "p. 180", "44%", "3:12", in the reading's unit */
export function atText(at: { page: number | null; percent: number | null; minutes: number | null }, unit: string): string {
  if (unit === "minutes" && at.minutes != null) return formatMinutes(at.minutes);
  if (unit === "pages" && at.page != null) return `p. ${at.page}`;
  if (at.percent != null) return `${Math.round(at.percent)}%`;
  return at.page != null ? `p. ${at.page}` : "the start";
}

/** "12 sessions · 9 h 40 min" */
export function sessionTotals(count: number, seconds: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}${seconds > 0 ? ` · ${durationWords(seconds)}` : ""}`;
}

function SessionLine({ s, row, today }: { s: SessionRow; row: ReadingRow; today: string }) {
  const r = row.reading;
  const zone = browserZone();
  const parts: string[] = [];
  if (s.startedAt) parts.push(`${wallTime(s.startedAt, s.timeZone)}${s.timeZone !== zone ? ` ${zoneCity(s.timeZone)}` : ""}`);
  if (s.durationSeconds) parts.push(durationWords(s.durationSeconds));
  if (s.pagesRead != null) parts.push(`${s.pagesRead} p.`);
  else parts.push(`to ${atText({ page: s.endPage, percent: s.endPercent, minutes: s.endMinutes }, r.unit)}`);
  // A pace from a few seconds says nothing
  if (s.pagesRead && s.durationSeconds && s.durationSeconds >= MIN_PACE_SECONDS) parts.push(`${Math.round(s.pagesRead / (s.durationSeconds / 3600))} p. an hour`);
  if (s.format !== r.format) parts.push(FORMAT_LABEL[s.format as ReadingFormat] ?? s.format);
  else if (s.editionId && s.editionId !== r.editionId && s.editionTitle) parts.push(s.editionTitle);
  return (
    <span className="min-w-0 flex-1">
      <span className="text-fg-primary">{formatReadingDate(s.readOn, "day", { omitYear: s.readOn.slice(0, 4) === today.slice(0, 4) })}</span>
      {parts.map((p, i) => (
        <span key={i} className="text-fg-secondary">
          {" · "}
          {p}
        </span>
      ))}
    </span>
  );
}

function SourceIcon({ source }: { source: string }) {
  const { icon: Icon, label } = SOURCE[source as SessionSource] ?? SOURCE.manual;
  return (
    <CapAligned height={16} className="text-xs">
      <span role="img" aria-label={label} data-tooltip={label} className="inline-flex text-fg-secondary">
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </span>
    </CapAligned>
  );
}

/** The sessions disclosure of one reading: open by default nowhere, totals on its button */
export function SessionList({ row, current }: { row: ReadingRow; current: boolean }) {
  const { data, open: openDialog, changed } = useReading();
  const timer = useOptionalTimer();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ running: SessionRow | null; sessions: SessionRow[] } | null>(null);
  const r = row.reading;
  const runningId = timer?.timer?.readingId === r.id ? timer.timer.sessionId : null;

  // Loads on opening, and again after any change to the reading or its timer
  useEffect(() => {
    if (!open) return;
    let live = true;
    getReadingSessions(r.id).then(
      (next) => live && setList(next),
      () => live && setList({ running: null, sessions: [] }),
    );
    return () => {
      live = false;
    };
  }, [open, r.id, row.fingerprint, runningId]);

  async function remove(s: SessionRow) {
    try {
      const result = await deleteSession({ sessionId: s.id, fingerprint: row.fingerprint });
      changed();
      undoToast("Deleted the session", async () => {
        try {
          await restoreSession({ readingId: r.id, fingerprint: result.reading.fingerprint, snapshot: result.session as unknown as Record<string, unknown> });
          changed();
        } catch (err) {
          showError(err, changed);
        }
      });
    } catch (err) {
      showError(err, changed);
    }
  }

  const count = row.sessionCount;
  const running = list?.running ?? null;
  const runningSeconds = running ? (timer?.timer?.sessionId === running.id ? timer.elapsed : elapsedSeconds({ ...running, startedAt: running.startedAt! })) : 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="pt-1" data-sessions={r.id}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 items-center gap-1 rounded-sm text-xs text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:h-11"
          data-sessions-toggle=""
        >
          <Chevron className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          {count || runningId ? sessionTotals(count, row.totalSeconds) : "No sessions yet"}
        </button>
        {current && (
          <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: "session", readingId: r.id })} className="pointer-coarse:h-11" data-session-add="">
            Add a session
          </Button>
        )}
      </div>
      {open && (
        <ol className="mt-1 text-xs" aria-busy={!list} data-session-list="">
          {!list && <li className="py-2 text-fg-secondary">Loading sessions...</li>}
          {running && (
            <li className="flex items-start gap-3 border-t border-glass-border py-2 first:border-t-0" data-session-running="">
              <SourceIcon source="timer" />
              <span className="min-w-0 flex-1 text-fg-primary">Running · {durationWords(runningSeconds)}</span>
            </li>
          )}
          {list?.sessions.map((s) => (
            <li key={s.id} className="flex items-start gap-3 border-t border-glass-border py-2 first:border-t-0" data-session={s.id}>
              <SourceIcon source={s.source} />
              <SessionLine s={s} row={row} today={data.today} />
              <CapAlignedControls height={32} coarseHeight={44} className="text-xs">
                <DropdownMenu
                  label="Session actions"
                  align="end"
                  trigger={
                    <button
                      type="button"
                      aria-label="Session actions"
                      data-tooltip="Session actions"
                      data-session-menu={s.id}
                      className="action-icon"
                    >
                      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  }
                >
                  <DropdownMenuItem onClick={() => openDialog({ kind: "session", readingId: r.id, session: s })}>Edit</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="danger" onClick={() => void remove(s)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenu>
              </CapAlignedControls>
            </li>
          ))}
          {list && !list.sessions.length && !running && <li className="py-2 text-fg-secondary">No sessions yet</li>}
        </ol>
      )}
    </div>
  );
}
