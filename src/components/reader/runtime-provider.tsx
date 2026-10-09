"use client";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ContextType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
import { TimerProvider, useOptionalTimer } from "@/components/reading/timer-provider";
import { ReadingDialogsProvider, PendingDialog } from "@/components/reading/reading-dialogs-provider";
import { DialogFocusScope } from "@/components/ui/dialog-focus-scope";
import { TooltipLayer } from "@/components/ui/tooltip";
import { acquireSurface, captureFocusOrigin, restoreFocusOrigin, type FocusOrigin, type SurfaceLease } from "@/lib/ui/surface-state";
import { handleReaderCommand, READER_COMMAND_EVENT } from "@/lib/ui/reader-command";
import { needsTimerCheck, acknowledgeTimerCheck } from "@/lib/reading/timer-alert";
import { TimerAlertGuardContext } from "@/components/reading/timer-alert-guard";
import type { ReaderRuntime } from "@/lib/reader/runtime";

function ReaderCommands() {
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);
  const [Host, setHost] = useState<ComponentType<{ open: boolean; close(): void }> | null>(null);
  const generation = useRef(0);
  const lease = useRef<SurfaceLease | null>(null);
  const origin = useRef<FocusOrigin | null>(null);
  const close = () => {
    const expected = ++generation.current;
    const previous = origin.current;
    lease.current?.release(); lease.current = null;
    setOpened(false);
    queueMicrotask(() => { if (generation.current === expected) restoreFocusOrigin(previous); });
  };
  const latestClose = useRef(close);
  latestClose.current = close;
  const load = async () => {
    const expected = ++generation.current;
    setFailed(false);
    try {
      const module = await import("./catalogue-commands");
      if (generation.current === expected) setHost(() => module.ReaderCatalogueCommands);
    } catch (error) {
      if (generation.current !== expected) return;
      console.error("[reader] Commands unavailable:", error); setFailed(true);
    }
  };
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    const open = () => {
      if (lease.current) { latestClose.current(); return; }
      origin.current = captureFocusOrigin();
      lease.current = acquireSurface(() => latestClose.current());
      setOpened(true); void latestLoad.current();
    };
    document.addEventListener("keydown", handleReaderCommand);
    window.addEventListener(READER_COMMAND_EVENT, open);
    return () => {
      generation.current++;
      lease.current?.release(); lease.current = null;
      document.removeEventListener("keydown", handleReaderCommand);
      window.removeEventListener(READER_COMMAND_EVENT, open);
    };
  }, []);
  if (!opened && !Host) return null;
  return <DialogFocusScope.Provider value={lease.current}>
    {Host && !failed ? <Host open={opened} close={close} /> : opened ? <PendingDialog failed={failed} close={close} retry={() => { void load(); }} /> : null}
  </DialogFocusScope.Provider>;
}

function ReaderTimerAlerts() {
  const timer = useOptionalTimer();
  const guard = useContext(TimerAlertGuardContext);
  const pending = useRef(new Map<string, { lease: SurfaceLease; close(): void }>());
  const [guardVersion, setGuardVersion] = useState(0);
  const [asking, setAsking] = useState(false);
  const needed = !!timer && timer.availability === "ready" && !!timer.timer &&
    (!!timer.conflict || timer.discarding || asking);
  const [Host, setHost] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latestTimer = useRef(timer);
  latestTimer.current = timer;
  useLayoutEffect(() => {
    if (!guard) return;
    const acquire = (kind: string, dismiss: () => void) => {
      if (pending.current.has(kind)) return;
      const close = () => {
        const item = pending.current.get(kind);
        if (!item?.lease.isTop()) return;
        item.lease.release(); pending.current.delete(kind);
        dismiss(); setGuardVersion((n) => n + 1);
      };
      pending.current.set(kind, { lease: acquireSurface(close), close });
      setGuardVersion((n) => n + 1);
    };
    guard.current = acquire;
    return () => {
      guard.current = null;
      pending.current.forEach((item) => item.lease.release()); pending.current.clear();
    };
  }, [guard]);
  useLayoutEffect(() => {
    const current = latestTimer.current;
    const check = !!current && current.availability === "ready" && !!current.timer && needsTimerCheck(current.timer, current.elapsed, current.checkMinutes);
    setAsking(check);
    if (!Host && check) guard?.current?.("forgotten", () => {
      const value = latestTimer.current;
      if (value?.timer) acknowledgeTimerCheck(value.timer, value.elapsed, value.checkMinutes);
      setAsking(false);
    });
    // Like the existing timer alert: check only when its snapshot refreshes.
  }, [guard, Host, timer?.timer, timer?.availability]);
  useLayoutEffect(() => {
    // Dialog layout effects have acquired their own leases before this runs.
    if (Host) { pending.current.forEach((item) => item.lease.release()); pending.current.clear(); }
  }, [Host, guardVersion]);
  useEffect(() => {
    if ((!needed && !pending.current.size) || Host) return;
    let live = true;
    void import("@/components/reading/timer-chip").then((module) => {
      if (live) setHost(() => module.TimerAlerts);
    }).catch((error: unknown) => {
      if (!live) return;
      console.error("[reader] Timer alert unavailable:", error); setFailed(true);
    });
    return () => { live = false; };
  }, [needed, Host, attempt, guardVersion]);
  const top = [...pending.current.values()].at(-1);
  if (!needed && !top) return null;
  if (failed && top) return <DialogFocusScope.Provider value={top.lease}>
    <PendingDialog failed close={top.close} retry={() => { setFailed(false); setAttempt((n) => n + 1); }} />
  </DialogFocusScope.Provider>;
  return Host ? <Host /> : top ? <DialogFocusScope.Provider value={top.lease}>
    <PendingDialog failed={false} close={top.close} retry={() => setAttempt((n) => n + 1)} />
  </DialogFocusScope.Provider> : null;
}

export function ReaderRuntimeProvider({ runtime, children }: { runtime: ReaderRuntime; children: ReactNode }) {
  const router = useRouter();
  const [guard] = useState(() => ({ current: null } as NonNullable<ContextType<typeof TimerAlertGuardContext>>));
  const content = <ReadingDialogsProvider>
    {children}
    <ReaderCommands />
    {runtime.status === "ready" && <ReaderTimerAlerts />}
    <TooltipLayer />
    <Toaster position="bottom-right" toastOptions={{ style: {
      background: "var(--color-bg-secondary)", border: "1px solid var(--color-bg-tertiary)", color: "var(--color-fg-primary)",
      fontFamily: "var(--font-sans)", fontSize: "0.875rem", borderRadius: "var(--radius-sm)",
    } }} />
    {runtime.status === "unavailable" && <aside role="alert" data-reader-runtime-unavailable="" className="fixed bottom-4 right-4 z-50 rounded-sm bg-bg-secondary p-4 text-sm text-fg-primary">
      <p>Reading timer settings are unavailable. Timer changes are disabled.</p>
      <button type="button" className="mt-2 underline pointer-coarse:min-h-11" onClick={() => router.refresh()}>Retry reading settings</button>
    </aside>}
  </ReadingDialogsProvider>;
  return <TimerAlertGuardContext.Provider value={guard}>
    {runtime.status === "ready" ? <TimerProvider initial={{ timer: runtime.value.runningTimer, checkMinutes: runtime.value.readingTimerCheckMinutes }}>{content}</TimerProvider> : content}
  </TimerAlertGuardContext.Provider>;
}
