"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { usePreference } from "@/lib/hooks/use-preference";
import { READING_HOME_KEY } from "@/lib/preferences";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { getReadingDialogData, pauseReading, resumeReading } from "@/lib/actions/reading";
import { showError, type ReadingPageData } from "./reading-client";
import { ReadingDialogSwitch, type DialogRequest, type ReadingDialog, type ReadingDialogProps, type StopRequest } from "./reading-provider";
import type { PickerPurpose } from "@/lib/reading/book-picker";

/*
 * The reading dialogs from any page (SLN-448): the palette, the hub, the
 * dashboard and a book page's `then`. A dialog loads its book's data when it
 * opens; a dialog on a reading sends the fingerprint its caller holds, so a
 * reading that changed elsewhere gets the server's reload message.
 */

const BookPicker = dynamic(() => import("./book-picker").then((m) => m.BookPicker));

/** A reading as a page holds it: enough to open a dialog on it */
export interface ReadingRef {
  workId: string;
  readingId: string;
  fingerprint: string;
}

export type ReadingDialogsRequest =
  | { kind: "start" | "past"; workId: string; editionId?: string | null }
  | ({ kind: Exclude<ReadingDialog, "start" | "past">; prefill?: string; timer?: StopRequest } & ReadingRef);

interface ReadingDialogsValue {
  /** Opens a dialog for a book, once its data has loaded */
  open: (request: ReadingDialogsRequest) => Promise<void>;
  /** Opens the book picker, then the dialog it was opened for */
  pick: (purpose: PickerPurpose) => void;
  /** Pause or resume without a dialog */
  setPaused: (paused: boolean, reading: ReadingRef) => Promise<void>;
}

const ReadingDialogsContext = createContext<ReadingDialogsValue | null>(null);

export function useReadingDialogs() {
  const value = useContext(ReadingDialogsContext);
  if (!value) throw new Error("useReadingDialogs needs ReadingDialogsProvider");
  return value;
}

/** The "I'm at" home to rank copies by */
const homeIdOf = (stored: string | null) => (stored && stored !== "none" ? stored : null);

interface Opened {
  data: ReadingPageData;
  /** The open dialog; null once it closed */
  request: DialogRequest | null;
}

export function ReadingDialogsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // The book stays loaded after its dialog closes, so a dialog can open the next one
  const [opened, setOpened] = useState<Opened | null>(null);
  const [picking, setPicking] = useState<PickerPurpose | null>(null);
  const [storedHome, setStoredHome] = usePreference<string | null>(READING_HOME_KEY, null);
  const workId = opened?.data.workId ?? null;
  const homeId = homeIdOf(storedHome);

  // After a write: the page, the activity timeline, and the loaded book
  const changed = useCallback(() => {
    router.refresh();
    triggerActivityRefresh();
    if (!workId) return;
    getReadingDialogData(workId, homeId)
      .then((data) => setOpened((now) => (now && now.data.workId === workId ? { ...now, data } : now)))
      .catch(() => undefined);
  }, [router, workId, homeId]);

  const open = useCallback(
    async (request: ReadingDialogsRequest) => {
      try {
        const data = await getReadingDialogData(request.workId, homeId);
        if (!("readingId" in request)) return setOpened({ data, request: { kind: request.kind, editionId: request.editionId ?? undefined } });
        const row = data.rows.find((r) => r.reading.id === request.readingId);
        if (!row) {
          toast.error("This reading no longer exists");
          return router.refresh();
        }
        // The caller's fingerprint, not the fresh one: a stale page must not save
        const rows = data.rows.map((r) => (r === row ? { ...r, fingerprint: request.fingerprint } : r));
        setOpened({ data: { ...data, rows }, request: { kind: request.kind, readingId: request.readingId, prefill: request.prefill, timer: request.timer } });
      } catch (err) {
        showError(err, () => router.refresh());
      }
    },
    [router, homeId],
  );

  const setPaused = useCallback(
    async (paused: boolean, reading: ReadingRef) => {
      try {
        const input = { readingId: reading.readingId, fingerprint: reading.fingerprint };
        if (paused) await pauseReading(input);
        else await resumeReading(input);
        toast.success(paused ? "Paused" : "Resumed");
        router.refresh();
        triggerActivityRefresh();
      } catch (err) {
        showError(err, () => router.refresh());
      }
    },
    [router],
  );

  const pick = useCallback((purpose: PickerPurpose) => setPicking(purpose), []);

  const value = useMemo(() => ({ open, pick, setPaused }), [open, pick, setPaused]);

  const request = opened?.request ?? null;
  const home =
    storedHome && opened && (storedHome === "none" || opened.data.homes.some((h) => h.id === storedHome)) ? storedHome : null;
  const props: ReadingDialogProps | null =
    opened && request
      ? {
          data: opened.data,
          row: request.readingId ? (opened.data.rows.find((r) => r.reading.id === request.readingId) ?? null) : null,
          request,
          home,
          setHome: (next) => setStoredHome(next),
          onClose: () => setOpened((now) => (now ? { ...now, request: null } : now)),
          changed,
          // A dialog that opens the next one (the last page opens Finish) stays on its book
          open: (next) => setOpened((now) => (now ? { ...now, request: next } : now)),
        }
      : null;

  return (
    <ReadingDialogsContext.Provider value={value}>
      {children}
      {props && <ReadingDialogSwitch {...props} />}
      {picking && <BookPicker purpose={picking} onClose={() => setPicking(null)} />}
    </ReadingDialogsContext.Provider>
  );
}
