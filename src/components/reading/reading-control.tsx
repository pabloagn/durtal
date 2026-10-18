"use client";

import { BookMarked, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { READING_KEYS } from "@/lib/shortcuts/shortcuts";
import {
  readingMenu,
  READING_ACTION_LABELS,
  type ReadingMenuAction,
} from "@/lib/reading/labels";
import { readingControlFromSummary } from "@/lib/reading/overview-summary";
import { ordinal } from "@/lib/reading/queue";
import { useReading } from "./reading-provider";

/** The R key of each action, shown in the menu */
const KEY_OF: Partial<Record<ReadingMenuAction, string>> = {
  start: READING_KEYS.start,
  reread: READING_KEYS.start,
  startAgain: READING_KEYS.start,
  progress: READING_KEYS.progress,
  pause: READING_KEYS.pause,
  resume: READING_KEYS.pause,
  finish: READING_KEYS.finish,
  abandon: READING_KEYS.abandon,
  past: READING_KEYS.past,
};

/**
 * The book's reading state as one button in the header (SLN-447): "Start
 * reading", "Reading · p. 212 of 480 · 44%", "Read 3 times · 2024", with the
 * actions that make sense in a menu. Beside an eBook's Read button it only
 * states an untracked book ("Unread"; the reader offers "Track this
 * book"): Read is the way in (SLN-683, SLN-801).
 */
export function ReadingControl({ ebook = false }: { ebook?: boolean }) {
  const { data, openRow, run, queuable, toggleQueue } = useReading();
  const state = data.summary.state;
  const label = readingControlFromSummary(data.summary, openRow?.reading ?? data.rows.find((row) => row.reading.id === data.summary.latestClosedId)?.reading ?? null, { ebook });
  return (
    <DropdownMenu
      label="Reading"
      align="start"
      trigger={
        <button
          type="button"
          data-reading-control
          className={`inline-flex h-8 max-w-full items-center gap-2 rounded-sm border border-glass-border bg-bg-secondary px-3 text-xs transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:h-11 ${
            state === "read" ? "text-accent-sage" : "text-fg-secondary"
          }`}
        >
          <BookMarked className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="whitespace-nowrap">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        </button>
      }
    >
      {readingMenu(state).map((action) => (
        <DropdownMenuItem
          key={action}
          onClick={() => run(action)}
          shortcut={
            KEY_OF[action] ? `R ${KEY_OF[action]!.toUpperCase()}` : undefined
          }
        >
          {READING_ACTION_LABELS[action]}
        </DropdownMenuItem>
      ))}
      {/* Up next (SLN-452), for an unread or read book */}
      {queuable && (state === "unread" || state === "read") && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => void toggleQueue()}
            shortcut={`R ${READING_KEYS.queue.toUpperCase()}`}
          >
            <span data-queue-toggle="">
              {data.queuePlace
                ? `In Up next, ${ordinal(data.queuePlace)} · Remove`
                : "Add to Up next"}
            </span>
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenu>
  );
}
