"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookCheck, BookMarked, BookPlus, BookX, CalendarClock, History, ListMinus, ListPlus, Pause, Play, Quote, Square, Timer } from "lucide-react";
import { useReadingActions, type EditItem } from "@/components/shortcuts/shortcuts-provider";
import { usePreference } from "@/lib/hooks/use-preference";
import { READING_HOME_KEY } from "@/lib/preferences";
import { READING_KEYS } from "@/lib/shortcuts/shortcuts";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { pauseReading, reopenReading, resumeReading, type SessionRow } from "@/lib/actions/reading";
import { bookReadingState, readingMenu, READING_ACTION_LABELS, type ReadingMenuAction } from "@/lib/reading/labels";
import { addToQueue, removeFromQueue, restoreQueueItem } from "@/lib/actions/reading-queue";
import { ordinal } from "@/lib/reading/queue";
import type { NoteItem } from "@/lib/actions/reading-notes";
import type { NoteKind } from "@/lib/reading/constants";
import { showError, undoToast, type ReadingPageData, type ReadingRow } from "./reading-client";
import { useOptionalTimer } from "./timer-provider";

/*
 * The book page's reading actions in one place (SLN-447): the header control,
 * the Reading section, the R menu, the palette and the actions menu all open
 * the same dialogs, which load only when opened.
 */

const StartReadingDialog = dynamic(() => import("./dialogs/start-reading-dialog").then((m) => m.StartReadingDialog));
const LogProgressDialog = dynamic(() => import("./dialogs/log-progress-dialog").then((m) => m.LogProgressDialog));
const FinishReadingDialog = dynamic(() => import("./dialogs/finish-reading-dialog").then((m) => m.FinishReadingDialog));
const AbandonReadingDialog = dynamic(() => import("./dialogs/abandon-reading-dialog").then((m) => m.AbandonReadingDialog));
const PastReadDialog = dynamic(() => import("./dialogs/past-read-dialog").then((m) => m.PastReadDialog));
const EditReadingDialog = dynamic(() => import("./dialogs/edit-reading-dialog").then((m) => m.EditReadingDialog));
const DeleteReadingDialog = dynamic(() => import("./dialogs/delete-reading-dialog").then((m) => m.DeleteReadingDialog));
const SessionDialog = dynamic(() => import("./dialogs/session-dialog").then((m) => m.SessionDialog));
const NoteDialog = dynamic(() => import("./dialogs/note-dialog").then((m) => m.NoteDialog));

export type ReadingDialog = "start" | "progress" | "finish" | "abandon" | "past" | "edit" | "delete" | "session" | "note";

const TimerBlockDialog = dynamic(() => import("./timer-chip").then((m) => m.TimerBlockDialog));

/** The dialog a request asks for; a dialog on a reading needs that reading */
export function ReadingDialogSwitch(props: ReadingDialogProps) {
  const { request, row } = props;
  // A reading being timed is not closed or deleted: its dialogs offer Stop and Discard (SLN-451)
  const timer = useOptionalTimer();
  if (row && timer?.timer?.readingId === row.reading.id && (request.kind === "finish" || request.kind === "abandon" || request.kind === "delete"))
    return <TimerBlockDialog {...props} />;
  if (request.kind === "start") return <StartReadingDialog {...props} />;
  if (request.kind === "past") return <PastReadDialog {...props} />;
  if (request.kind === "note") return <NoteDialog {...props} />;
  if (!row) return null;
  if (request.kind === "progress") return <LogProgressDialog {...props} />;
  if (request.kind === "finish") return <FinishReadingDialog {...props} />;
  if (request.kind === "abandon") return <AbandonReadingDialog {...props} />;
  if (request.kind === "edit") return <EditReadingDialog {...props} />;
  if (request.kind === "session") return <SessionDialog {...props} />;
  return <DeleteReadingDialog {...props} />;
}

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
  /** Start reading with this edition: the one queued in Up Next (SLN-452) */
  editionId?: string;
  /** The note dialog (SLN-453): a quote or a note, on `readingId` when given */
  noteKind?: NoteKind;
  /** The note dialog edits this note; without one it adds */
  note?: NoteItem;
  /** The page to fill, from Log progress */
  page?: number | null;
  /** The dialog to go back to once the note dialog closes (Log progress) */
  back?: DialogRequest;
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

interface ReadingContextValue {
  data: ReadingPageData;
  openRow: ReadingRow | null;
  open: (request: DialogRequest) => void;
  run: (action: ReadingMenuAction, row?: ReadingRow | null) => void;
  /** Starts the timer on the open reading, or stops it when it runs on this book (SLN-451) */
  toggleTimer: () => void;
  /** After a write: refresh the page and the activity timeline */
  changed: () => void;
  /** The book can go in Up Next: a book page with no open reading (SLN-452) */
  queuable: boolean;
  /** Adds the book to Up Next, or removes it with Undo */
  toggleQueue: () => Promise<void>;
}

const ReadingContext = createContext<ReadingContextValue | null>(null);

export function useReading() {
  const value = useContext(ReadingContext);
  if (!value) throw new Error("useReading needs ReadingProvider");
  return value;
}

/** The reading actions, where a ReadingProvider is on the page (book pages); null elsewhere */
export function useOptionalReading() {
  return useContext(ReadingContext);
}

export function ReadingProvider({ data, children }: { data: ReadingPageData; children: ReactNode }) {
  const router = useRouter();
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [storedHome, setStoredHome] = usePreference<string | null>(READING_HOME_KEY, null);
  // A remembered home that is no longer a home is no home
  const home = storedHome && (storedHome === "none" || data.homes.some((h) => h.id === storedHome)) ? storedHome : null;
  const openRow = data.rows.find((r) => r.reading.status === "reading" || r.reading.status === "paused") ?? null;

  const changed = useCallback(() => {
    router.refresh();
    triggerActivityRefresh();
  }, [router]);

  const open = useCallback((next: DialogRequest) => setRequest(next), []);

  const run = useCallback(
    async (action: ReadingMenuAction, row: ReadingRow | null = openRow) => {
      try {
        if (action === "start" || action === "reread" || action === "startAgain") return open({ kind: "start" });
        if (action === "past") return open({ kind: "past" });
        // "Resume this reading" acts on the latest read, which is abandoned
        if (action === "resumeAbandoned" && !row) row = data.rows.find((r) => r.reading.status === "abandoned") ?? null;
        if (!row) return;
        const readingId = row.reading.id;
        if (action === "progress") return open({ kind: "progress", readingId });
        if (action === "finish") return open({ kind: "finish", readingId });
        if (action === "abandon") return open({ kind: "abandon", readingId });
        if (action === "edit") return open({ kind: "edit", readingId });
        if (action === "pause") {
          await pauseReading({ readingId, fingerprint: row.fingerprint });
          toast.success("Paused");
        } else if (action === "resume") {
          await resumeReading({ readingId, fingerprint: row.fingerprint });
          toast.success("Resumed");
        } else if (action === "resumeAbandoned") {
          await reopenReading({ readingId, fingerprint: row.fingerprint, toStatus: "reading" });
          toast.success("Reading again");
        }
        changed();
      } catch (err) {
        showError(err, changed);
      }
    },
    [openRow, open, changed, data.rows],
  );

  // The timer (SLN-451): start it on the open reading, or stop it in stop mode when it runs here
  const timer = useOptionalTimer();
  const timing = !!openRow && timer?.timer?.readingId === openRow.reading.id;
  const toggleTimer = useCallback(() => {
    if (!openRow || !timer) return;
    const running = timer.timer;
    if (running && running.readingId === openRow.reading.id)
      return open({
        kind: "progress",
        readingId: openRow.reading.id,
        timer: { sessionId: running.sessionId, startedAt: running.startedAt, pausedAt: running.pausedAt, pausedSeconds: running.pausedSeconds },
      });
    void timer.start({ readingId: openRow.reading.id, workId: data.workId, title: data.workTitle });
  }, [openRow, timer, open, data.workId, data.workTitle]);

  // Up Next (SLN-452): add the book, or take it off; an open reading is never queued
  const queuable = data.queuePlace !== undefined && !openRow;
  const toggleQueue = useCallback(async () => {
    try {
      if (data.queuePlace) {
        const removed = await removeFromQueue({ workId: data.workId });
        changed();
        undoToast(`Removed ${data.workTitle} from Up Next`, async () => {
          try {
            await restoreQueueItem(removed);
            changed();
          } catch (err) {
            showError(err, changed);
          }
        });
      } else {
        const { place } = await addToQueue({ workId: data.workId });
        changed();
        toast.success(`Added ${data.workTitle} to Up Next, ${ordinal(place)}`);
      }
    } catch (err) {
      showError(err, changed);
    }
  }, [data.queuePlace, data.workId, data.workTitle, changed]);

  // The R menu and the palette: the actions that make sense now
  const state = bookReadingState(data.rows.map((r) => r.reading));
  const menu = readingMenu(state);
  const items: EditItem[] = [];
  const startAction = menu.find((a) => a === "start" || a === "reread" || a === "startAgain");
  if (startAction) items.push({ key: READING_KEYS.start, label: READING_ACTION_LABELS[startAction], icon: BookPlus, run: () => run(startAction) });
  if (openRow) {
    items.push({ key: READING_KEYS.progress, label: "Log progress", icon: BookMarked, run: () => run("progress") });
    items.push(
      openRow.reading.status === "reading"
        ? { key: READING_KEYS.pause, label: "Pause", icon: Pause, run: () => run("pause") }
        : { key: READING_KEYS.pause, label: "Resume", icon: Play, run: () => run("resume") },
    );
    items.push({ key: READING_KEYS.finish, label: "Finish", icon: BookCheck, run: () => run("finish") });
    items.push({ key: READING_KEYS.abandon, label: "Abandon", icon: BookX, run: () => run("abandon") });
    if (timer)
      items.push(
        timing
          ? { key: READING_KEYS.timer, label: "Stop timer", icon: Square, run: toggleTimer }
          : { key: READING_KEYS.timer, label: "Start timer", icon: Timer, run: toggleTimer },
      );
  }
  if (queuable)
    items.push(
      data.queuePlace
        ? { key: READING_KEYS.queue, label: "Remove from Up Next", icon: ListMinus, run: () => void toggleQueue() }
        : { key: READING_KEYS.queue, label: "Add to Up Next", icon: ListPlus, run: () => void toggleQueue() },
    );
  items.push({ key: READING_KEYS.past, label: "Log a past read", icon: CalendarClock, run: () => run("past") });
  items.push({
    key: READING_KEYS.quote,
    label: "Add a quote",
    icon: Quote,
    run: () => open({ kind: "note", noteKind: "quote", readingId: openRow?.reading.id }),
  });
  if (data.rows.length)
    items.push({
      key: READING_KEYS.history,
      label: "Go to the Reading section",
      icon: History,
      run: () => document.getElementById("reading")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    });
  useReadingActions(items);

  const context = useMemo(
    () => ({ data, openRow, open, run, toggleTimer, changed, queuable, toggleQueue }),
    [data, openRow, open, run, toggleTimer, changed, queuable, toggleQueue],
  );
  const row = request?.readingId ? (data.rows.find((r) => r.reading.id === request.readingId) ?? null) : null;
  const props: ReadingDialogProps | null = request
    ? {
        data,
        row,
        request,
        home,
        setHome: (next) => setStoredHome(next),
        onClose: () => setRequest(null),
        changed,
        open,
      }
    : null;

  return (
    <ReadingContext.Provider value={context}>
      {children}
      {props && <ReadingDialogSwitch {...props} />}
    </ReadingContext.Provider>
  );
}
