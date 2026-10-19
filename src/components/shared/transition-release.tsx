"use client";

import { useEffect, useState } from "react";

/**
 * Lets a page that has its new content show it (SLN-1141). After a save, the
 * refreshed page sometimes stayed on the old content for about 4 s, until the
 * toast left or the pointer moved.
 *
 * React suspends the refresh until the new server data arrives. When a piece
 * of that data has arrived but is still unread at that moment, reading it
 * answers at once, during the render, and React drops that answer: the
 * refresh waits on data it already holds, with nothing left to wake it. The
 * favourite button's async transition loses its answer the same way. Any
 * urgent update wakes it, which is why the toast leaving or a pointer move
 * showed the page.
 *
 * So each time a request finishes, this makes one urgent update of its own.
 * React then tries the waiting refresh again, which now finds its data. With
 * nothing waiting, the update renders nothing and costs nothing.
 */
export function TransitionRelease() {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let frame = 0;
    const wake = () => {
      frame = 0;
      setTick((tick) => tick + 1);
    };
    const observer = new PerformanceObserver((list) => {
      const fetched = list
        .getEntries()
        .some((entry) => (entry as PerformanceResourceTiming).initiatorType === "fetch");
      if (fetched && !frame) frame = requestAnimationFrame(wake);
    });
    try {
      observer.observe({ type: "resource" });
    } catch {
      return;
    }
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
