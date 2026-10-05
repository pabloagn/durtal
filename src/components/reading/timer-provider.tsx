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
  timer: RunningTimer | null;
  /** Seconds of reading so far, ticking */
  elapsed: number;
  checkMinutes: number;
  refresh: () => Promise<RunningTimer | null>;
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

export function TimerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { readingTimerCheckMinutes } = useAppSettings();
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pendingStart, setPendingStart] = useState<TimerTarget | null>(null);
  const [conflict, setConflict] = useState<TimerTarget | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const live = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getRunningTimer();
      if (live.current) setTimer(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  // After mount, on focus and when the tab shows again
  useEffect(() => {
    live.current = true;
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const first = window.setTimeout(onFocus, 0);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live.current = false;
      window.clearTimeout(first);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // The display ticks while a timer runs; a paused one stands still
  useEffect(() => {
    if (!timer || timer.pausedAt) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [timer]);

  /**
   * A refused write loads the timer again. When the timer it was about is no
   * longer running, it was stopped on another device; that is said in words
   * here, since a production build hides the server's message.
   */
  const failed = useCallback(
    async (err: unknown, sessionId?: string) => {
      const next = await refresh();
      if (sessionId && next?.sessionId !== sessionId) return void toast.error(TIMER_GONE);
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
      const running = await refresh();
      if (running) return running.readingId === target.readingId ? void toast.message(`The timer is running for ${running.title}`) : setConflict(target);
      try {
        await startTimer({ readingId: target.readingId, timeZone: browserZone() });
        await refresh();
        toast.success(`Timer started for ${target.title}`);
        changed();
      } catch (err) {
        const now = await refresh();
        if (now && now.readingId !== target.readingId) return setConflict(target);
        await failed(err);
      }
    },
    [refresh, changed, failed],
  );

  const pause = useCallback(async () => {
    if (!timer) return;
    try {
      setTimer(await pauseTimer({ sessionId: timer.sessionId }));
    } catch (err) {
      await failed(err, timer.sessionId);
    }
  }, [timer, failed]);

  const resume = useCallback(async () => {
    if (!timer) return;
    try {
      setTimer(await resumeTimer({ sessionId: timer.sessionId }));
    } catch (err) {
      await failed(err, timer.sessionId);
    }
  }, [timer, failed]);

  const discard = useCallback(async () => {
    if (!timer) return;
    try {
      await discardTimer({ sessionId: timer.sessionId });
      setTimer(null);
      toast.success(`Discarded the timer for ${timer.title}`);
      changed();
    } catch (err) {
      await failed(err, timer.sessionId);
    }
  }, [timer, failed, changed]);

  const elapsed = timer ? elapsedSeconds(timer, new Date(now)) : 0;
  const value = useMemo(
    () => ({
      timer,
      elapsed,
      checkMinutes: readingTimerCheckMinutes,
      refresh,
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
    [timer, elapsed, readingTimerCheckMinutes, refresh, start, pause, resume, discard, pendingStart, conflict, discarding],
  );
  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}
