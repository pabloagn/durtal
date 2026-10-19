"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { usePreference } from "@/lib/hooks/use-preference";
import { READING_HOME_KEY } from "@/lib/preferences";
import { isUuid } from "@/lib/utils/uuid";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { getReadingDialogData } from "@/lib/actions/reading";
import { pauseReading, resumeReading } from "@/lib/actions/catalogue-client";
import { showError, type ReadingPageData } from "./reading-client";
import type { DialogRequest, ReadingDialog, ReadingDialogProps, StopRequest } from "./reading-dialog-types";
import type { ReadingDialogHostProps } from "./reading-dialog-host";
import type { PickerPurpose } from "@/lib/reading/book-picker";
import type { NoteEdit } from "@/lib/actions/reading-notes";
import type { NoteKind } from "@/lib/reading/constants";
import { acquireSurface, captureFocusOrigin, restoreFocusOrigin, type FocusOrigin, type SurfaceLease } from "@/lib/ui/surface-state";
import { DialogFocusScope } from "@/components/ui/dialog-focus-scope";
import { PendingDialog, preloadFeature } from "@/components/ui/feature-renderer";
import { readingDialogRenderers } from "./reading-dialog-renderers";
export { PendingDialog } from "@/components/ui/feature-renderer";

export interface ReadingRef { workId: string; readingId: string; fingerprint: string }
export type ReadingDialogsRequest =
  | { kind: "start" | "past"; workId: string; editionId?: string | null }
  | { kind: "note"; workId: string; readingId?: string | null; noteKind?: NoteKind; note?: NoteEdit }
  | ({ kind: Exclude<ReadingDialog, "start" | "past" | "note">; prefill?: string; timer?: StopRequest } & ReadingRef);
interface ReadingDialogsValue {
  open(request: ReadingDialogsRequest): Promise<void>;
  pick(purpose: PickerPurpose): void;
  setPaused(paused: boolean, reading: ReadingRef): Promise<void>;
}
const ReadingDialogsContext = createContext<ReadingDialogsValue | null>(null);
export function useReadingDialogs() {
  const value = useContext(ReadingDialogsContext);
  if (!value) throw new Error("useReadingDialogs needs ReadingDialogsProvider");
  return value;
}
const homeIdOf = (value: unknown) => typeof value === "string" && isUuid(value) ? value : null;
type Intent = { request: ReadingDialogsRequest } | { picker: PickerPurpose } | { continuation: DialogRequest; workId: string };
interface Display {
  generation: number;
  hostKey: number;
  home: string | null;
  origin: FocusOrigin | null;
  lease: SurfaceLease;
  intent: Intent;
  data: ReadingPageData | null;
  request: DialogRequest | null;
  Host: ComponentType<ReadingDialogHostProps> | null;
  error: boolean;
}

let hostImport: Promise<typeof import("./reading-dialog-host")> | null = null;
function loadDialogHost() {
  if (!hostImport) hostImport = import("./reading-dialog-host").catch((error: unknown) => {
    hostImport = null;
    throw error;
  });
  return hostImport;
}

export function ReadingDialogsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [display, setDisplay] = useState<Display | null>(null);
  const [storedHome, setStoredHome] = usePreference<string | null>(READING_HOME_KEY, null);
  const generation = useRef(0);
  const current = useRef<Display | null>(null);
  const lastOrigin = useRef<FocusOrigin | null>(null);
  const live = useRef(true);
  const close = useCallback(() => {
    const previous = current.current;
    const expected = ++generation.current;
    current.current = null;
    previous?.lease.release();
    lastOrigin.current = previous?.origin ?? null;
    setDisplay(null);
    queueMicrotask(() => {
      if (generation.current !== expected) return;
      restoreFocusOrigin(previous?.origin ?? null);
      lastOrigin.current = null;
    });
  }, []);
  const commit = useCallback((next: Display) => {
    if (!live.current || generation.current !== next.generation) return;
    current.current = next;
    setDisplay(next);
  }, []);
  const load = useCallback(async (pending: Display) => {
    // The dialog itself starts loading alongside its host and data, so it
    // opens as soon as they are in, with no second "Loading…" (SLN-1464)
    const kind = "request" in pending.intent ? pending.intent.request.kind : "continuation" in pending.intent ? pending.intent.continuation.kind : null;
    if (kind) void preloadFeature(readingDialogRenderers[kind]);
    try {
      const [module, data] = await Promise.all([
        loadDialogHost(),
        "request" in pending.intent ? getReadingDialogData(pending.intent.request.workId, pending.home, "readingId" in pending.intent.request ? pending.intent.request.readingId ?? null : null)
          : "continuation" in pending.intent ? getReadingDialogData(pending.intent.workId, pending.home, pending.intent.continuation.readingId ?? null) : Promise.resolve(null),
      ]);
      if (!live.current || generation.current !== pending.generation) return;
      let request: DialogRequest | null = "continuation" in pending.intent ? pending.intent.continuation : null;
      if ("request" in pending.intent && data) {
        const intent = pending.intent.request;
        if (intent.kind === "note") request = { kind: "note", readingId: intent.readingId ?? undefined, noteKind: intent.noteKind, note: intent.note };
        else if (!("readingId" in intent)) request = { kind: intent.kind, editionId: intent.editionId ?? undefined };
        else {
          const row = data.rows.find((item) => item.reading.id === intent.readingId);
          if (!row) { toast.error("This reading no longer exists"); router.refresh(); close(); return; }
          // The immutable caller snapshot remains the stale-write check.
          data.rows = data.rows.map((item) => item === row ? { ...item, fingerprint: intent.fingerprint } : item);
          request = { kind: intent.kind, readingId: intent.readingId, prefill: intent.prefill, timer: intent.timer };
        }
      }
      commit({ ...pending, data, request, Host: module.ReadingDialogHost });
    } catch (error) {
      if (!live.current || generation.current !== pending.generation) return;
      console.error("[reading] Dialog could not load:", error);
      commit({ ...pending, error: true });
    }
  }, [close, commit, router]);
  const begin = useCallback((intent: Intent) => {
    const previous = current.current;
    const origin = previous?.origin ?? lastOrigin.current ?? captureFocusOrigin();
    previous?.lease.release();
    const next: Display = {
      generation: ++generation.current, hostKey: generation.current, home: homeIdOf(storedHome), origin,
      lease: acquireSurface(close, origin), intent, data: null, request: null, Host: null, error: false,
    };
    current.current = next;
    setDisplay(next);
    return load(next);
  }, [close, load, storedHome]);
  const open = useCallback((request: ReadingDialogsRequest) => {
    // Snapshot selected quote, timer and fingerprint before the first await.
    return begin({ request: structuredClone(request) });
  }, [begin]);
  const pick = useCallback((purpose: PickerPurpose) => { void begin({ picker: purpose }); }, [begin]);
  const setPaused = useCallback(async (paused: boolean, reading: ReadingRef) => {
    const input = { readingId: reading.readingId, fingerprint: reading.fingerprint };
    try {
      if (paused) await pauseReading(input); else await resumeReading(input);
      toast.success(paused ? "Paused" : "Resumed"); router.refresh(); triggerActivityRefresh();
    } catch (error) { showError(error, () => router.refresh()); }
  }, [router]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      const previous = current.current;
      const expected = ++generation.current;
      previous?.lease.release();
      queueMicrotask(() => { if (!live.current && generation.current === expected) restoreFocusOrigin(previous?.origin ?? null); });
    };
  }, []);
  const changed = useCallback((expected: number) => {
    router.refresh(); triggerActivityRefresh();
    const before = current.current;
    if (!before?.data || before.generation !== expected) return;
    void getReadingDialogData(before.data.workId, before.home, before.request?.readingId ?? null).then((data) => {
      const latest = current.current;
      if (live.current && latest?.generation === expected && generation.current === expected) commit({ ...latest, data });
    }).catch((error: unknown) => {
      const latest = current.current;
      if (!live.current || latest?.generation !== expected || generation.current !== expected) return;
      console.error("[reading] Dialog reload failed:", error);
      commit({ ...latest, error: true });
    });
  }, [commit, router]);
  const continuation = useCallback((expected: number, request: DialogRequest) => {
    const before = current.current;
    if (!before?.data || before.generation !== expected) return;
    const next: Display = {
      ...before, generation: ++generation.current, hostKey: generation.current,
      intent: { continuation: structuredClone(request), workId: before.data.workId },
      request: null, data: null, Host: null, error: false,
    };
    commit(next);
    void load(next);
  }, [commit, load]);
  const value = useMemo(() => ({ open, pick, setPaused }), [open, pick, setPaused]);
  const props: ReadingDialogProps | null = display?.data && display.request ? {
    data: display.data,
    row: display.request.readingId ? display.data.rows.find((row) => row.reading.id === display.request!.readingId) ?? null : null,
    request: display.request,
    home: typeof storedHome === "string" && (storedHome === "none" || display.data.homes.some((home) => home.id === storedHome)) ? storedHome : null,
    setHome: (next) => {
      const before = current.current;
      if (before?.generation !== display.generation) return;
      setStoredHome(next);
      commit({ ...before, generation: ++generation.current, home: homeIdOf(next) });
    },
    onClose: () => { if (current.current?.generation === display.generation) close(); },
    changed: () => changed(display.generation),
    open: (next) => continuation(display.generation, next),
  } : null;
  const Host = display?.Host;
  return <ReadingDialogsContext.Provider value={value}>
    {children}
    {display && <DialogFocusScope.Provider value={display.lease}>
      {Host && !display.error ? <Host key={display.hostKey} dialog={props} picker={"picker" in display.intent ? display.intent.picker : null} onClose={close} onFailure={(error) => {
        if (generation.current !== display.generation) return;
        console.error("[reading] Dialog renderer failed:", error);
        commit({ ...display, error: true });
      }} /> : <PendingDialog failed={display.error} close={close} retry={() => { void begin(display.intent); }} />}
    </DialogFocusScope.Provider>}
  </ReadingDialogsContext.Provider>;
}
