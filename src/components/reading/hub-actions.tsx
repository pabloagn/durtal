"use client";

import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useReadingDialogs, type ReadingRef } from "./reading-dialogs-provider";

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

/** The empty hub's one action */
export function StartBookButton() {
  const { pick } = useReadingDialogs();
  return (
    <Button variant="primary" onClick={() => pick("start")} className="pointer-coarse:h-11">
      Start a book
    </Button>
  );
}

/** A current reading's card: Log progress, and Pause, Finish, Abandon, Open book */
export function ReadingCardActions({ reading, href, title }: { reading: ReadingRef; href: string; title: string }) {
  const { open, setPaused } = useReadingDialogs();
  const router = useRouter();
  const label = `More for ${title}`;
  return (
    <div className="flex items-center gap-2">
      <Button size="md" onClick={() => void open({ kind: "progress", ...reading })} className="pointer-coarse:h-11" data-hub-log={reading.readingId}>
        Log progress
      </Button>
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
