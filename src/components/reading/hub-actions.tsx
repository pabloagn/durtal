"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MoreHorizontal, Square, Timer } from "lucide-react";
import { useOptionalTimer } from "./timer-provider";
import { useStopTimer } from "./timer-chip";
import { Button, buttonClass } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useReadingDialogs, type ReadingRef } from "./reading-dialogs-provider";
import { LazyGoalDialog } from "./goal-dialog-button";

/*
 * The reading hub's and the dashboard's buttons (SLN-448): small client
 * islands on server-rendered cards. Every one sends the reading's fingerprint
 * as the page loaded it.
 */

const menuButton =
  "flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:h-11 pointer-coarse:w-11";

/** "Start a book" and "Log a past read": the book picker */
export function HubActions() {
  const { pick } = useReadingDialogs();
  return (
    <>
      <Button variant="secondary" onClick={() => pick("past")} className="pointer-coarse:h-11">
        Log a past read
      </Button>
      <Button variant="primary" onClick={() => pick("start")} className="pointer-coarse:h-11" data-hub-start="">
        Start a book
      </Button>
    </>
  );
}

/** The hub's header menu (SLN-455): the goal dialog and the reading rhythm setting */
export function HubMenu({ rhythm }: { rhythm: boolean }) {
  const router = useRouter();
  const [goals, setGoals] = useState(false);
  // A text button like the header's others: an icon alone would sit off the 46px title's cap height
  return (
    <>
      <DropdownMenu
        label="Goals and rhythm"
        align="end"
        trigger={
          <button type="button" className={`${buttonClass("secondary")} pointer-coarse:h-11`} data-hub-menu-open="">
            Goals
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          </button>
        }
      >
        <DropdownMenuItem onClick={() => setGoals(true)}>Set a reading goal</DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/settings/reading#reading-rhythm-days")}>
          {rhythm ? "Change the reading rhythm" : "Set a reading rhythm"}
        </DropdownMenuItem>
      </DropdownMenu>
      {goals && <LazyGoalDialog onClose={() => setGoals(false)} />}
    </>
  );
}

/** The empty hub's one action */
export function StartBookButton() {
  const { pick } = useReadingDialogs();
  return (
    <Button variant="primary" onClick={() => pick("start")} className="pointer-coarse:h-11">
      Start a book
    </Button>
  );
}

/** "Add a quote" from the commonplace book (SLN-453): the book picker, then the note dialog */
export function AddQuoteButton({ variant = "secondary" }: { variant?: "primary" | "secondary" | "ghost" }) {
  const { pick } = useReadingDialogs();
  return (
    <Button variant={variant} onClick={() => pick("quote")} className="pointer-coarse:h-11" data-notes-pick="">
      Add a quote
    </Button>
  );
}

/** A current reading's card: Log progress, and Pause, Finish, Abandon, Add a quote, Open book */
export function ReadingCardActions({ reading, href, title }: { reading: ReadingRef; href: string; title: string }) {
  const { open, setPaused } = useReadingDialogs();
  const router = useRouter();
  const label = `More for ${title}`;
  const timer = useOptionalTimer();
  const stopTimer = useStopTimer();
  const timing = timer?.timer?.readingId === reading.readingId;
  const timerLabel = timing ? "Stop timer" : "Start timer";
  return (
    <div className="flex items-center gap-2">
      <Button size="md" onClick={() => void open({ kind: "progress", ...reading })} className="pointer-coarse:h-11" data-hub-log={reading.readingId}>
        Log progress
      </Button>
      {timer && (
        <button
          type="button"
          aria-label={`${timerLabel} for ${title}`}
          data-tooltip={timerLabel}
          className={menuButton}
          data-hub-timer={reading.readingId}
          onClick={() => (timing ? stopTimer() : void timer.start({ readingId: reading.readingId, workId: reading.workId, title }))}
        >
          {timing ? <Square className="h-4 w-4" strokeWidth={1.5} /> : <Timer className="h-4 w-4" strokeWidth={1.5} />}
        </button>
      )}
      <DropdownMenu
        label={label}
        align="end"
        trigger={
          <button type="button" aria-label={label} data-tooltip="More" className={menuButton} data-hub-menu={reading.readingId}>
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </button>
        }
      >
        <DropdownMenuItem onClick={() => void setPaused(true, reading)}>Pause</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void open({ kind: "finish", ...reading })}>Finish</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void open({ kind: "abandon", ...reading })}>Abandon</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void open({ kind: "note", workId: reading.workId, readingId: reading.readingId, noteKind: "quote" })}>
          Add a quote
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push(href)}>Open book</DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}

/** A paused reading's Resume */
export function ResumeButton({ reading }: { reading: ReadingRef }) {
  const { setPaused } = useReadingDialogs();
  return (
    <Button variant="ghost" onClick={() => void setPaused(false, reading)} className="pointer-coarse:h-11" data-hub-resume={reading.readingId}>
      Resume
    </Button>
  );
}

/** Up Next's Start (SLN-452): the Start dialog with the queued edition */
export function QueueStartButton({ workId, editionId, title }: { workId: string; editionId: string | null; title: string }) {
  const { open } = useReadingDialogs();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void open({ kind: "start", workId, editionId })}
      aria-label={`Start reading ${title}`}
      className="pointer-coarse:h-11"
      data-hub-queue-start={workId}
    >
      Start
    </Button>
  );
}

/** The dashboard tile's small Log button */
export function LogButton({ reading, title }: { reading: ReadingRef; title: string }) {
  const { open } = useReadingDialogs();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void open({ kind: "progress", ...reading })}
      aria-label={`Log progress on ${title}`}
      className="pointer-coarse:h-11"
      data-dashboard-log={reading.readingId}
    >
      Log
    </Button>
  );
}

/** A journal row's menu: Edit and Delete, each with Undo */
export function JournalRowMenu({ reading, title }: { reading: ReadingRef; title: string }) {
  const { open } = useReadingDialogs();
  const label = `More for this reading of ${title}`;
  return (
    <DropdownMenu
      label={label}
      align="end"
      trigger={
        <button type="button" aria-label={label} data-tooltip="More" className={menuButton} data-journal-menu={reading.readingId}>
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
        </button>
      }
    >
      <DropdownMenuItem onClick={() => void open({ kind: "edit", ...reading })}>Edit</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="danger" onClick={() => void open({ kind: "delete", ...reading })}>
        Delete
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
