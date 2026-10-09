"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  }
>(function SelectionToolbar({ selection, bridge, onClear }, forwardedRef) {
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
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountSlot = useCallback(
    (element: HTMLDivElement | null) =>
      bridge.mountSlot("selection-actions", element),
    [bridge],
  );
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
  useLayoutEffect(() => {
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
  }, [selection]);
  const copy = async () => {
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(selection.text);
      setCopyState({ selection, kind: "copied" });
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(
        () => setCopyState({ selection, kind: "ready" }),
        2000,
      );
    } catch {
      setCopyState({ selection, kind: "failed" });
    }
  };
  // Keep the slot mounted even without a selection, so plugin order and subscriptions are stable.
  return (
    <div
      ref={setRef}
      role="toolbar"
      aria-label="Selection actions"
      data-reader-chrome
      hidden={!selection}
      className="glass fixed z-50 flex max-w-[calc(100%_-_32px)] items-center gap-1 overflow-hidden p-1 text-sm text-fg-primary"
      style={position}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClear();
        }
      }}
    >
      <button
        type="button"
        aria-label="Copy selected text"
        data-tooltip="Copy selected text"
        onClick={() => void copy()}
        className="h-8 rounded-sm px-3 hover:bg-bg-tertiary [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
      >
        {failed ? "Copy failed" : copied ? "Copied" : "Copy"}
      </button>
      <div ref={mountSlot} className="flex min-w-0 items-center gap-1" />
    </div>
  );
});
