"use client";

import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent, type TouchEvent } from "react";

/**
 * Context/long-press opens the existing menu; moving or scrolling keeps ordinary touch navigation.
 * The lift that ends a long-press is cancelled, so the browser sends no mousedown after it: that
 * mousedown landed outside the menu and closed it as the finger left (SLN-1150). iOS's own link
 * preview stays off the cover (`data-long-press`, globals.css).
 */
export function useCoverMenu(enabled: boolean, open: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const cancel = useCallback(function cancelGesture(): void {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
    document.removeEventListener("scroll", cancelGesture, true);
  }, []);
  useEffect(() => {
    if (!enabled) { cancel(); suppressClick.current = false; }
    return cancel;
  }, [cancel, enabled]);
  return {
    "data-long-press": enabled ? "" : undefined,
    onContextMenu(event: MouseEvent) {
      if (!enabled) return;
      cancel();
      event.preventDefault();
      event.stopPropagation();
      open();
    },
    onPointerDown(event: PointerEvent) {
      if (!enabled || event.pointerType !== "touch" || !event.isPrimary) return;
      cancel(); suppressClick.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      document.addEventListener("scroll", cancel, { capture: true, passive: true });
      timer.current = setTimeout(() => {
        cancel(); suppressClick.current = true; open();
      }, 550);
    },
    onPointerMove(event: PointerEvent) {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onTouchEnd(event: TouchEvent) {
      if (suppressClick.current && event.cancelable) event.preventDefault();
    },
    onPointerCancel() { cancel(); suppressClick.current = false; },
    onPointerLeave: cancel,
    onClickCapture(event: MouseEvent) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault(); event.stopPropagation();
    },
  };
}
