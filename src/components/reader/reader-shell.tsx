"use client";

import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** The bars hide this long after they show, while reading */
export const BARS_HIDE_MS = 3000;
/** The mouse this close to the top or bottom edge brings the bars back */
const EDGE_PX = 56;

/**
 * The reader's two bars, shown and hidden together (eBooks sub-issue 3).
 * They show on open and hide after 3 seconds, or at once on a page turn.
 * They stay while the pointer is over them, focus is in them, or `held`
 * (a dialog is open, the book is still opening).
 */
export function useReaderBars({ held }: { held: boolean }) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const over = useRef(false);
  const heldRef = useRef(held);
  const visibleRef = useRef(visible);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const kept = () => over.current || heldRef.current;

  const hideSoon = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!kept()) setVisible(false);
    }, BARS_HIDE_MS);
  }, []);

  const show = useCallback(() => {
    setVisible(true);
    hideSoon();
  }, [hideSoon]);

  const hide = useCallback(() => {
    if (kept()) return;
    clear();
    setVisible(false);
  }, []);

  const toggle = useCallback(() => {
    if (visibleRef.current) hide();
    else show();
  }, [hide, show]);

  /** The mouse at y in the viewport */
  const pointerAt = useCallback(
    (y: number) => {
      if (y <= EDGE_PX || y >= window.innerHeight - EDGE_PX) show();
    },
    [show],
  );

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  // Held bars show and stay; once let go, they hide after the usual wait
  const [wasHeld, setWasHeld] = useState(held);
  if (held !== wasHeld) {
    setWasHeld(held);
    if (held) setVisible(true);
  }
  useEffect(() => {
    heldRef.current = held;
    if (held) clear();
    else hideSoon();
  }, [held, hideSoon]);

  useEffect(() => clear, []);

  /** Spread on what wraps the bars */
  const barEvents = {
    onPointerEnter: () => {
      over.current = true;
    },
    onPointerLeave: () => {
      over.current = false;
      hideSoon();
    },
    onFocus: () => {
      over.current = true;
      show();
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      over.current = false;
      hideSoon();
    },
  };

  return { visible, visibleRef, show, hide, toggle, pointerAt, barEvents };
}

/**
 * The reading view's frame (eBooks sub-issue 3): the book fills the
 * viewport, the bars float over it, and the state (opening, an error) sits
 * in the middle.
 */
export const ReaderShell = forwardRef<
  HTMLDivElement,
  {
    bars: ReactNode;
    barEvents: ReturnType<typeof useReaderBars>["barEvents"];
    overlay?: ReactNode;
    children?: ReactNode;
  }
>(function ReaderShell({ bars, barEvents, overlay, children }, bookRef) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-bg-primary text-fg-primary" data-reader>
      <div ref={bookRef} className="absolute inset-0" />
      {overlay}
      <div className="contents" {...barEvents}>
        {bars}
      </div>
      {children}
    </div>
  );
});
