"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Ellipsis } from "lucide-react";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { EngineEvents } from "@/lib/reader/engine";

export const selectionToolbarPosition = (
  rect: { left: number; top: number; right: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  ios: boolean,
) => ({
  left: Math.max(
    16,
    Math.min(
      viewport.width - size.width - 16,
      (rect.left + rect.right - size.width) / 2,
    ),
  ),
  top: Math.max(
    16,
    Math.min(
      viewport.height - size.height - 16,
      !ios && rect.top - size.height - 8 >= 16
        ? rect.top - size.height - 8
        : rect.bottom + 8,
    ),
  ),
});

export const SelectionToolbar = forwardRef<
  HTMLDivElement,
  {
    selection: EngineEvents["selection"];
    bridge: ReaderBridgeController;
    onClear(): void;
    markingActions?: ReactNode;
    onReadAloud?(): void;
    speechReady?: boolean;
    /** What covers the bottom of the screen (the bar, the player), for the docked toolbar */
    bottomInset?: number;
    /** What covers the top of the screen (the bar), for the toolbar docked at the top */
    topInset?: number;
    /** Look up's sheet covers the screen on touch: the toolbar steps aside */
    covered?: boolean;
  }
>(function SelectionToolbar(
  { selection, bridge, onClear, markingActions, onReadAloud, speechReady, bottomInset = 0, topInset = 0, covered = false },
  forwardedRef,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [copyState, setCopyState] = useState<{
    selection: EngineEvents["selection"];
    kind: "ready" | "copied" | "failed";
  }>({ selection: null, kind: "ready" });
  const copied =
    copyState.selection === selection && copyState.kind === "copied";
  const failed =
    copyState.selection === selection && copyState.kind === "failed";
  const [position, setPosition] = useState({ left: 16, top: 16 });
  // On touch the toolbar docks at the bottom: following the selection put it
  // under the finger dragging the selection handles, and it jumped with every
  // change while the iOS edit menu took the space above the text.
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setDocked(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountSlot = useCallback(
    (element: HTMLDivElement | null) =>
      bridge.mountSlot("selection-actions", element),
    [bridge],
  );
  const mountMore = useCallback(
    (element: HTMLDivElement | null) =>
      bridge.mountSlot("selection-more", element),
    [bridge],
  );
  // On touch the less used actions wait behind More, so the toolbar is one row
  const [more, setMore] = useState(false);
  const [moreFor, setMoreFor] = useState(selection);
  if (moreFor !== selection) {
    setMoreFor(selection);
    if (!selection) setMore(false);
  }
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      ref.current = element;
      if (typeof forwardedRef === "function") forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    },
    [forwardedRef],
  );
  useEffect(() => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [selection]);
  const [dockHeight, setDockHeight] = useState(48);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!docked || !element) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (height) setDockHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [docked]);
  useLayoutEffect(() => {
    if (docked) return;
    const reposition = () => {
      if (!selection || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      setPosition(
        selectionToolbarPosition(
          selection.rect,
          rect,
          { width: window.innerWidth, height: window.innerHeight },
          ios,
        ),
      );
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [selection, docked]);
  const copy = async () => {
    const captured = bridge.captureSelection();
    if (!captured) return;
    try {
      await navigator.clipboard.writeText(captured.text);
      if (!bridge.isSelectionCaptureCurrent(captured)) return;
      setCopyState({ selection, kind: "copied" });
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(
        () => setCopyState({ selection, kind: "ready" }),
        2000,
      );
    } catch {
      if (!bridge.isSelectionCaptureCurrent(captured)) return;
      setCopyState({ selection, kind: "failed" });
    }
  };
  const copyButton = (
    <button
      type="button"
      aria-label="Copy selected text"
      data-tooltip="Copy selected text"
      onClick={() => void copy()}
      className="h-8 shrink-0 rounded-sm px-3 hover:bg-bg-tertiary [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
    >
      {failed ? "Copy failed" : copied ? "Copied" : "Copy"}
    </button>
  );
  const readAloud = onReadAloud && (
    <button
      type="button"
      aria-label="Read aloud from here"
      data-tooltip="Read aloud from here"
      onClick={onReadAloud}
      disabled={!speechReady}
      className="h-8 shrink-0 rounded-sm px-3 hover:bg-bg-tertiary disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    >
      Read aloud from here
    </button>
  );
  // Docked, the toolbar sits at the bottom unless the selection is there; then at the top.
  // The room kept is the toolbar's own height, so opening More never covers the selection.
  const dockTop =
    docked &&
    !!selection &&
    selection.rect.bottom > window.innerHeight - bottomInset - dockHeight - 48;
  // Keep the slot mounted even without a selection, so plugin order and subscriptions are stable.
  return (
    <div
      ref={setRef}
      role="toolbar"
      aria-label="Selection actions"
      data-reader-chrome
      hidden={!selection || covered}
      data-docked={docked || undefined}
      // Docked at the bottom, the toasts sit above it (AppToaster)
      data-toast-avoid={docked && !dockTop ? "" : undefined}
      className={`glass fixed z-50 overflow-hidden text-sm text-fg-primary ${
        docked
          ? "inset-x-2 flex flex-col gap-0.5 p-0.5"
          : "flex max-w-[calc(100%_-_32px)] flex-wrap items-center gap-1 p-1"
      }`}
      style={
        docked
          ? dockTop
            ? { top: `calc(max(${topInset}px, env(safe-area-inset-top)) + 12px)` }
            : { bottom: `calc(max(${bottomInset}px, env(safe-area-inset-bottom)) + 12px)` }
          : position
      }
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClear();
        }
      }}
    >
      {docked ? (
        <>
          <div className="flex items-center">
            {/* One row, never wrapped: on the narrowest phones the swatches
                give up width (never under 32px, always 44px tall) so Note and
                Look up stay whole beside More (SLN-678) */}
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_[role=group]]:min-w-0 [&_[role=group]]:shrink [&_[role=group]]:flex-nowrap [&_[role=group]]:gap-0 [&_[role=group]>button]:min-w-8 [&_[role=group]>button]:shrink">
              {markingActions}
              <div ref={mountSlot} className="flex shrink-0 items-center" />
            </div>
            <button
              type="button"
              aria-label="More actions"
              aria-expanded={more}
              data-tooltip="More actions"
              onClick={() => setMore((open) => !open)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm hover:bg-bg-tertiary"
            >
              <Ellipsis className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
          <div
            hidden={!more}
            className="flex flex-wrap items-center gap-0.5 border-t border-glass-border pt-0.5"
          >
            {copyButton}
            {readAloud}
            <div ref={mountMore} className="flex items-center" />
          </div>
        </>
      ) : (
        <>
          {markingActions}
          {copyButton}
          {readAloud}
          <div ref={mountMore} className="flex min-w-0 items-center gap-1" />
          <div ref={mountSlot} className="flex min-w-0 items-center gap-1" />
        </>
      )}
    </div>
  );
});
