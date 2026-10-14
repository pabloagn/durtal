"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getReaderRuntime } from "@/lib/reader/offline/runtime";
import { syncPaused } from "@/lib/reader/offline/sync-paused";

const CHECK_MS = 5000;

/**
 * Whether this browser's reader sync is paused, checked while the page is
 * visible, with a Retry that sends the queue again now (SLN-668).
 */
export function useSyncPaused() {
  const [paused, setPaused] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const check = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (cancelled) return;
      try {
        const rows = await (await getReaderRuntime()).store.inspect();
        if (!cancelled) setPaused(syncPaused(rows, navigator.onLine));
      } catch {
        /* no reader persistence here: nothing to say */
      }
      if (!cancelled && document.visibilityState === "visible")
        timer = setTimeout(() => void run(), CHECK_MS);
    };
    check.current = run;
    const wake = () => void run();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    window.addEventListener("durtal-reader-persistence", wake);
    // The first check waits, so it never competes with opening the book
    timer = setTimeout(() => void run(), CHECK_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
      window.removeEventListener("durtal-reader-persistence", wake);
    };
  }, []);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await (await getReaderRuntime()).retryNow();
    } catch {
      /* the check below says whether it is still paused */
    } finally {
      await check.current();
      setRetrying(false);
    }
  }, []);

  return { paused, retrying, retry };
}
