"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookCheck, BookMarked, BookPlus, BookX, CalendarClock, History, Pause, Play } from "lucide-react";
import { useReadingActions, type EditItem } from "@/components/shortcuts/shortcuts-provider";
import { usePreference } from "@/lib/hooks/use-preference";
import { READING_HOME_KEY } from "@/lib/preferences";
import { READING_KEYS } from "@/lib/shortcuts/shortcuts";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { pauseReading, reopenReading, resumeReading } from "@/lib/actions/reading";
import { bookReadingState, readingMenu, READING_ACTION_LABELS, type ReadingMenuAction } from "@/lib/reading/labels";
import { showError, type ReadingPageData, type ReadingRow } from "./reading-client";

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

export type ReadingDialog = "start" | "progress" | "finish" | "abandon" | "past" | "edit" | "delete";

export interface DialogRequest {
  kind: ReadingDialog;
  readingId?: string;
  /** Finish after a log that reached the last page: the date to fill */
  finishedOn?: string;
  reachedEnd?: boolean;
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

export function ReadingProvider({
  data,
  startOnLoad = false,
  children,
}: {
  data: ReadingPageData;
  /** "Start reading" from the Finish dialog's next-in-series panel */
  startOnLoad?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [request, setRequest] = useState<DialogRequest | null>(startOnLoad ? { kind: "start" } : null);
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
    [openRow, open, changed],
  );

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
  }
  items.push({ key: READING_KEYS.past, label: "Log a past read", icon: CalendarClock, run: () => run("past") });
  if (data.rows.length)
    items.push({
      key: READING_KEYS.history,
      label: "Go to the Reading section",
      icon: History,
      run: () => document.getElementById("reading")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    });
  useReadingActions(items);

  // A finished book whose page was opened to start reading: clear the parameter
  useEffect(() => {
    if (!startOnLoad) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("reading");
    window.history.replaceState(null, "", url);
  }, [startOnLoad]);

  const context = useMemo(() => ({ data, openRow, open, run }), [data, openRow, open, run]);
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
      {props?.request.kind === "start" && <StartReadingDialog {...props} />}
      {props?.request.kind === "progress" && row && <LogProgressDialog {...props} />}
      {props?.request.kind === "finish" && row && <FinishReadingDialog {...props} />}
      {props?.request.kind === "abandon" && row && <AbandonReadingDialog {...props} />}
      {props?.request.kind === "past" && <PastReadDialog {...props} />}
      {props?.request.kind === "edit" && row && <EditReadingDialog {...props} />}
      {props?.request.kind === "delete" && row && <DeleteReadingDialog {...props} />}
    </ReadingContext.Provider>
  );
}
