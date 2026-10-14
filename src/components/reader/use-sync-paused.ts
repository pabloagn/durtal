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
  // The head this page has seen first in the queue, and since when
  const first = useRef<{ seq: number; at: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (cancelled) return;
      try {
        const rows = await (await getReaderRuntime()).store.inspect();
        const head = rows[0];
        if (!head) first.current = null;
        else if (first.current?.seq !== head.seq)
          first.current = { seq: head.seq, at: Date.now() };
        const firstMs = first.current ? Date.now() - first.current.at : 0;
        if (!cancelled) setPaused(syncPaused(rows, navigator.onLine, firstMs));
      } catch {
        /* no reader persistence here: nothing to say */
      }
      if (!cancelled && document.visibilityState === "visible")
        timer = setTimeout(() => void run(), CHECK_MS);
    };
    check.current = run;
    const wake = (event: Event) => {
      // Time hidden or offline is not time stuck: the queue does not send then
      if (event.type === "visibilitychange" || event.type === "online")
        first.current = null;
      void run();
    };
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
