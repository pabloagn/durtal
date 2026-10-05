"use client";

import { BookMarked, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { READING_KEYS } from "@/lib/shortcuts/shortcuts";
import {
  bookReadingState,
  readingControlLabel,
  readingMenu,
  READING_ACTION_LABELS,
  type ReadingMenuAction,
} from "@/lib/reading/labels";
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
 * actions that make sense in a menu.
 */
export function ReadingControl() {
  const { data, run } = useReading();
  const readings = data.rows.map((r) => r.reading);
  const state = bookReadingState(readings);
  const label = readingControlLabel(readings);
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
        <DropdownMenuItem key={action} onClick={() => run(action)}>
          <span className="flex-1">{READING_ACTION_LABELS[action]}</span>
          {KEY_OF[action] && (
            <span className="ml-4 font-mono text-micro text-fg-secondary">R {KEY_OF[action]!.toUpperCase()}</span>
          )}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
