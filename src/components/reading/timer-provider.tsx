"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { discardTimer, getRunningTimer, pauseTimer, resumeTimer, startTimer } from "@/lib/actions/reading";
import type { RunningTimer } from "@/lib/reading/timer-service";
import { elapsedSeconds, TIMER_GONE } from "@/lib/reading/timer";
import { browserZone } from "./reading-client";
import { TimerAlertGuardContext } from "./timer-alert-guard";

/*
 * The one reading timer, wherever Durtal is open (SLN-451). It loads after
 * mount, on window focus and when the tab becomes visible, so a timer started
 * on the phone shows on the desktop when he looks: no polling, no sockets.
 * The time ticks in the browser from the start and the pauses.
 */

export interface TimerTarget {
  readingId: string;
  workId: string;
  title: string;
}

interface TimerValue {
  availability: "loading" | "ready" | "unavailable";
  timer: RunningTimer | null;
  /** Seconds of reading so far, ticking */
  elapsed: number;
  checkMinutes: number;
  refresh: () => Promise<RunningTimer | null>;
  /** Fence reads around a timer write made by a dialog, including Undo. */
  runMutation: <T>(write: () => Promise<T>) => Promise<T>;
  start: (target: TimerTarget) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  discard: () => Promise<void>;
  /** A start waiting for the running timer to stop ("Stop it and start this one") */
  pendingStart: TimerTarget | null;
  setPendingStart: (target: TimerTarget | null) => void;
  /** A refused start: the running timer's book, for the "Stop it and start this one" question */
  conflict: TimerTarget | null;
  setConflict: (target: TimerTarget | null) => void;
  /** The discard question is open */
  discarding: boolean;
  setDiscarding: (open: boolean) => void;
}

const TimerContext = createContext<TimerValue | null>(null);

export function useTimer() {
  const value = useContext(TimerContext);
  if (!value) throw new Error("useTimer needs TimerProvider");
  return value;
}

/** The timer where a TimerProvider is mounted; null elsewhere (tests, isolated components) */
export function useOptionalTimer() {
  return useContext(TimerContext);
}

export function TimerProvider({ children, initial }: {
  children: ReactNode;
  initial?: { timer: RunningTimer | null; checkMinutes: number };
}) {
  const router = useRouter();
  const { readingTimerCheckMinutes } = useAppSettings();
  const [timer, setTimer] = useState<RunningTimer | null>(() => initial?.timer ?? null);
  const [availability, setAvailability] = useState<TimerValue["availability"]>(initial ? "ready" : "loading");
  const availabilityRef = useRef(availability);
  availabilityRef.current = availability;
  const [now, setNow] = useState(() => Date.now());
  const [pendingStart, setPendingStart] = useState<TimerTarget | null>(null);
  const [conflict, setConflictState] = useState<TimerTarget | null>(null);
  const [discarding, setDiscardingState] = useState(false);
  const alertGuard = useContext(TimerAlertGuardContext);
  const setConflict = useCallback((target: TimerTarget | null) => {
    if (target) alertGuard?.current?.("conflict", () => setConflictState(null));
    setConflictState(target);
  }, [alertGuard]);
  const setDiscarding = useCallback((open: boolean) => {
    if (open) alertGuard?.current?.("discard", () => setDiscardingState(false));
    setDiscardingState(open);
  }, [alertGuard]);
  const live = useRef(true);
  const generation = useRef(0);
  const query = useRef<{ generation: number; promise: Promise<RunningTimer | null> } | null>(null);
  const mutation = useRef<Promise<void> | null>(null);

  const refresh = useCallback(function refresh(): Promise<RunningTimer | null> {
    if (!live.current) return Promise.reject(new Error("Timer provider closed"));
    if (mutation.current) return mutation.current.then(refresh);
    const expected = generation.current;
    if (query.current?.generation === expected) return query.current.promise;
    const promise = getRunningTimer().then((next) => {
      if (expected !== generation.current) return refresh();
      if (live.current) {
        setTimer(next);
        availabilityRef.current = "ready";
        setAvailability("ready");
      }
      return next;
    }).catch((error: unknown) => {
      if (expected !== generation.current) return refresh();
      if (live.current) {
        availabilityRef.current = "unavailable";
        setAvailability("unavailable");
      }
      throw error;
    }).finally(() => {
      if (query.current?.promise === promise) query.current = null;
    });
    query.current = { generation: expected, promise };
    return promise;
  }, []);

  const runMutation = useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    if (availabilityRef.current === "unavailable") await refresh();
    if (mutation.current) throw new Error("A timer change is still saving");
    let finish!: () => void;
    mutation.current = new Promise<void>((resolve) => { finish = resolve; });
    generation.current++;
    let result: T;
    try {
      result = await write();
    } finally {
      generation.current++;
      mutation.current = null;
      finish();
    }
    // The write committed. A failed read is visible, but cannot undo its result.
    await refresh().catch(() => undefined);
    return result;
  }, [refresh]);

  // After mount, on focus and when the tab shows again
  useEffect(() => {
    live.current = true;
    const onFocus = () => { void refresh().catch(() => undefined); };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    // A successful server snapshot already did this read for this request.
    const first = initial ? null : window.setTimeout(onFocus, 0);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live.current = false;
      generation.current++;
      if (first !== null) window.clearTimeout(first);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, initial]);

  // The display ticks while a timer runs; a paused one stands still
  useEffect(() => {
    if (!timer || timer.pausedAt || availability !== "ready") return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [timer, availability]);

  /**
   * A refused write loads the timer again. When the timer it was about is no
   * longer running, it was stopped on another device; that is said in words
   * here, since a production build hides the server's message.
   */
  const failed = useCallback(
    async (err: unknown, sessionId?: string) => {
      try {
        const next = await refresh();
        if (sessionId && next?.sessionId !== sessionId) return void toast.error(TIMER_GONE);
      } catch {
        toast.error("The timer is unavailable. Retry before changing it.");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Could not save");
    },
    [refresh],
  );

  const changed = useCallback(() => {
    router.refresh();
    triggerActivityRefresh();
  }, [router]);

  const start = useCallback(
    async (target: TimerTarget) => {
      // One timer: a running one, here or on another device, is asked about first
      let running: RunningTimer | null;
      try {
        running = await refresh();
      } catch {
        toast.error("The timer is unavailable. Retry before changing it.");
        return;
      }
      if (running) return running.readingId === target.readingId ? void toast.message(`The timer is running for ${running.title}`) : setConflict(target);
      try {
        await runMutation(async () => {
          await startTimer({ readingId: target.readingId, timeZone: browserZone() });
        });
        toast.success(`Timer started for ${target.title}`);
        changed();
      } catch (err) {
        try {
          const now = await refresh();
          if (now && now.readingId !== target.readingId) return setConflict(target);
        } catch {
          toast.error("The timer is unavailable. Retry before changing it.");
          return;
        }
        toast.error(err instanceof Error ? err.message : "Could not save");
      }
    },
    [refresh, runMutation, changed, setConflict],
  );

  const pause = useCallback(async () => {
    if (!timer || availability !== "ready") return;
    try {
      await runMutation(async () => {
        const next = await pauseTimer({ sessionId: timer.sessionId });
        if (live.current) setTimer(next);
      });
    } catch (err) {
      await failed(err, timer.sessionId);
    }
  }, [timer, availability, runMutation, failed]);

  const resume = useCallback(async () => {
    if (!timer || availability !== "ready") return;
    try {
      await runMutation(async () => {
        const next = await resumeTimer({ sessionId: timer.sessionId });
        if (live.current) setTimer(next);
      });
    } catch (err) {
      await failed(err, timer.sessionId);
    }
  }, [timer, availability, runMutation, failed]);

  const discard = useCallback(async () => {
    if (!timer || availability !== "ready") return;
    try {
      await runMutation(async () => {
        await discardTimer({ sessionId: timer.sessionId });
        if (live.current) setTimer(null);
      });
      toast.success(`Discarded the timer for ${timer.title}`);
      changed();
    } catch (err) {
      await failed(err, timer.sessionId);
    }
  }, [timer, availability, runMutation, failed, changed]);

  const elapsed = timer ? elapsedSeconds(timer, new Date(now)) : 0;
  const value = useMemo(
    () => ({
      timer,
      availability,
      elapsed,
      checkMinutes: initial?.checkMinutes ?? readingTimerCheckMinutes,
      refresh,
      runMutation,
      start,
      pause,
      resume,
      discard,
      pendingStart,
      setPendingStart,
      conflict,
      setConflict,
      discarding,
      setDiscarding,
    }),
    [timer, availability, elapsed, initial?.checkMinutes, readingTimerCheckMinutes, refresh, runMutation, start, pause, resume, discard, pendingStart, conflict, setConflict, discarding, setDiscarding],
  );
  return <TimerContext.Provider value={value}>
    {children}
    {availability === "unavailable" && <aside role="alert" data-timer-unavailable="" className="fixed bottom-4 right-4 z-50 rounded-sm bg-bg-secondary p-4 text-sm text-fg-primary">
      <p>The timer is unavailable. Changes are disabled until it reconnects.</p>
      <button type="button" onClick={() => { void refresh().catch(() => undefined); }} className="mt-2 underline pointer-coarse:min-h-11">Retry timer</button>
    </aside>}
  </TimerContext.Provider>;
}
