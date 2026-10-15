"use client";

import {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** The bars hide this long after they show, while reading */
export const BARS_HIDE_MS = 3000;
/** The outer share of the width where a resting mouse keeps that side's page button up */
export const EDGE_HOVER = 0.12;

/**
 * The reader's two bars, shown and hidden together (eBooks sub-issue 3).
 * They show on open and whenever the mouse moves, anywhere on the page, and
 * hide 3 seconds after it rests, or at once on a page turn (SLN-663: no hot
 * strip to hover, so crossing the page never makes them blink). They stay
 * while the pointer is over them, focus is in them, or `held` (a dialog is
 * open, the book is still opening, the toolbars are pinned).
 */
export function useReaderBars({ held }: { held: boolean }) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pointer over the bars, and focus in them: each keeps them up
  const pointerOver = useRef(false);
  const focusIn = useRef(false);
  const heldRef = useRef(held);
  const visibleRef = useRef(visible);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const kept = () => pointerOver.current || focusIn.current || heldRef.current;
  /** The mouse at x, y in the viewport. A layout change can repeat a still
   * pointer's last position: only real movement counts. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  // A mouse over the book is off the bars, though Firefox sends no leave
  // when a menu or panel opened from them closes under it
  const offBars = () => {
    const at = lastPointer.current;
    if (at && document.elementFromPoint(at.x, at.y)?.closest("#reader-book")) pointerOver.current = false;
  };

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

  /**
   * Reading on (a turn, a scroll) lets go of focus left in the bars, as when
   * a panel closes back onto the button that opened it: they go as after any
   * turn, and focus with them; Tab brings both back. A moving mouse lets go
   * of it too (`pointerAt`), and a mouse resting over the book is off them.
   */
  const release = useCallback(() => {
    const keeping = focusIn.current || pointerOver.current;
    focusIn.current = false;
    offBars();
    if (keeping && visibleRef.current) hideSoon();
  }, [hideSoon]);

  const toggle = useCallback(() => {
    if (visibleRef.current) hide();
    else show();
  }, [hide, show]);

  /** The margin the mouse is in: its page button stays up there after the
   * bars hide (SLN-662), without a hot strip that brings the bars back */
  const [edge, setEdge] = useState<"left" | "right" | null>(null);
  const pointerAt = useCallback(
    (x: number, y: number) => {
      const width = typeof window === "undefined" ? 0 : window.innerWidth;
      setEdge(!width ? null : x < width * EDGE_HOVER ? "left" : x > width * (1 - EDGE_HOVER) ? "right" : null);
      const last = lastPointer.current;
      lastPointer.current = { x, y };
      if (last && Math.hypot(x - last.x, y - last.y) < 2) return;
      if (!last) return;
      // A mouse that moves is a reader's hand, not a keyboard user's focus
      focusIn.current = false;
      offBars();
      show();
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

  // A mouse that leaves the window is in neither margin
  useEffect(() => {
    const left = () => setEdge(null);
    document.documentElement.addEventListener("mouseleave", left);
    return () => document.documentElement.removeEventListener("mouseleave", left);
  }, []);

  /** Spread on what wraps the bars */
  const barEvents = {
    onPointerEnter: () => {
      pointerOver.current = true;
    },
    onPointerLeave: () => {
      pointerOver.current = false;
      hideSoon();
    },
    onFocus: () => {
      focusIn.current = true;
      show();
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null))
        return;
      focusIn.current = false;
      hideSoon();
    },
  };

  return { visible, visibleRef, edge, show, hide, release, toggle, pointerAt, barEvents };
}

const BookFrame = memo(
  forwardRef<HTMLDivElement>(function BookFrame(_props, ref) {
    return <div id="reader-book" ref={ref} className="absolute inset-0" />;
  }),
);

/**
 * The reading view's frame (eBooks sub-issue 3): the book fills the
 * viewport, the bars float over it, and the state (opening, an error) sits
 * in the middle.
 */
export const ReaderShell = forwardRef<
  HTMLDivElement,
  {
    topBar: ReactNode;
    bottomBar: ReactNode;
    player?: ReactNode;
    /** The mouse's page turn buttons, kept up like the bars while hovered */
    edges?: ReactNode;
    skipLink?: ReactNode;
    barEvents: ReturnType<typeof useReaderBars>["barEvents"];
    /** opening, ready or error: for the reader's checks (scripts/qa/reader-engine-check.mjs) */
    state: string;
    overlay?: ReactNode;
    children?: ReactNode;
  }
>(function ReaderShell(
  { topBar, bottomBar, player, edges, skipLink, barEvents, state, overlay, children },
  bookRef,
) {
  return (
    <div
      className="fixed inset-0 overflow-hidden bg-bg-primary text-fg-primary"
      data-reader={state}
    >
      {skipLink}
      <div className="contents" {...barEvents}>
        {topBar}
      </div>
      <BookFrame ref={bookRef} />
      <div className="contents" {...barEvents}>
        {edges}
        {player}
        {bottomBar}
      </div>
      {overlay}
      {children}
    </div>
  );
});
