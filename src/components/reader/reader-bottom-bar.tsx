"use client";
import { useCallback, useSyncExternalStore } from "react";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";

/**
 * The reader's bottom bar (eBooks sub-issue 3): the chapter and how far
 * through the book. Shows and hides with the top bar; hidden, it is inert.
 */
export function ReaderBottomBar({
  visible,
  chapter,
  percent,
  bridge,
}: {
  visible: boolean;
  chapter: string | null;
  /** 0 to 100, or null before the book has opened */
  percent: number | null;
  bridge: ReaderBridgeController;
}) {
  const slots = useSyncExternalStore(
    bridge.subscribeSlots,
    bridge.getSlots,
    bridge.getSlots,
  );
  const mount = useCallback(
    (element: HTMLDivElement | null) =>
      bridge.mountSlot("toolbar-status", element),
    [bridge],
  );
  return (
    <footer
      data-reader-chrome
      inert={!visible}
      className={`glass-bar fixed inset-x-0 bottom-0 z-30 border-t border-glass-border pb-[env(safe-area-inset-bottom)] transition-[opacity,translate] duration-200 motion-reduce:transition-none ${
        visible ? "" : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <div className="flex h-9 [@media(pointer:coarse)]:h-11 items-center gap-4 px-4 text-sm text-fg-secondary">
        <p className="min-w-0 flex-1 truncate">{chapter}</p>
        <div
          ref={mount}
          hidden={!slots["toolbar-status"]}
          className="lines-1 min-w-0 max-w-[60%] overflow-hidden whitespace-nowrap"
        />
        {!slots["toolbar-status"] && percent !== null && (
          <p className="shrink-0 tabular-nums">{percent}%</p>
        )}
      </div>
    </footer>
  );
}
