import type { SessionRow } from "@/lib/actions/reading";
import type { NoteEdit } from "@/lib/actions/reading-notes";
import type { NoteKind } from "@/lib/reading/constants";
import type { LogDraft } from "./dialogs/log-progress-dialog";
import type { ReadingPageData, ReadingRow } from "./reading-client";

export type ReadingDialog = "start" | "progress" | "finish" | "abandon" | "past" | "edit" | "delete" | "session" | "note";

export interface DialogRequest {
  kind: ReadingDialog;
  readingId?: string;
  /** Finish after a log that reached the last page: the date to fill */
  finishedOn?: string;
  reachedEnd?: boolean;
  /** Log progress opened from the palette with what was typed ("212") */
  prefill?: string;
  /** Log progress in stop mode: saving stops this running timer (SLN-451) */
  timer?: StopRequest;
  /** The session dialog edits this session; without one it adds a session (SLN-451) */
  session?: SessionRow;
  /** Start reading: the edition queued in Up Next (SLN-452). The note dialog: the edition the quote is filed under (SLN-480) */
  editionId?: string;
  /** The note dialog (SLN-453): a quote or a note, on `readingId` when given */
  noteKind?: NoteKind;
  /** The note dialog edits this note; without one it adds */
  note?: NoteEdit;
  /** The page to fill, from Log progress */
  page?: number | null;
  /** The percent to fill, from Log progress on a session counted in percent or time: the note dialog opens in Percent, even for null (SLN-480) */
  percent?: number | null;
  /** The dialog to go back to once the note dialog closes (Log progress) */
  back?: DialogRequest;
  /** Log progress on the way back from the note dialog: what was typed there */
  draft?: LogDraft;
}

/** The running timer a stop saves, and the end time a forgotten timer was given */
export interface StopRequest {
  sessionId: string;
  startedAt: string;
  pausedAt: string | null;
  pausedSeconds: number;
  endedAt?: string;
}

/** What every dialog receives */
export interface ReadingDialogProps {
  data: ReadingPageData;
  row: ReadingRow | null;
  request: DialogRequest;
  home: string | null;
  setHome: (home: string | null) => void;
  onClose: () => void;
  /** After a write: refresh the page and the activity timeline */
  changed: () => void;
  open: (request: DialogRequest) => void;
}
