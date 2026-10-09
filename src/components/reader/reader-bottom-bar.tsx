"use client";
import { useCallback, useSyncExternalStore } from "react";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { DurtalLocator } from "@/lib/reader/engine";
import type { PositionIndex } from "@/lib/reader/position-index";
import { pageText } from "@/lib/reader/running-lines";
import { ProgressScrubber } from "./progress-scrubber";
import { Hash, PanelBottom } from "lucide-react";

/**
 * The reader's bottom bar (eBooks sub-issue 3): the chapter and how far
 * through the book. Shows and hides with the top bar; hidden, it is inert.
 */
export function ReaderBottomBar({
  visible,
  chapter,
  percent,
  bridge,
  index,
  locator,
  linear,
  timeLeftChapter,
  onGoTo,
  onRunningLines,
  onScrub,
  onPeek,
}: {
  visible: boolean;
  chapter: string | null;
  /** 0 to 100, or null before the book has opened */
  percent: number | null;
  bridge: ReaderBridgeController;
  index?: PositionIndex | null;
  locator?: DurtalLocator | null;
  linear?: boolean;
  timeLeftChapter?: string;
  onGoTo?(): void;
  onRunningLines?(): void;
  onScrub?(fraction: number): void;
  onPeek?(active: boolean): void;
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
      data-reader-index={index?.complete ? "ready" : "pending"}
      inert={!visible}
      className={`glass-bar fixed inset-x-0 bottom-0 z-30 border-t border-glass-border pb-[env(safe-area-inset-bottom)] transition-[opacity,translate] duration-200 motion-reduce:transition-none ${
        visible ? "" : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <div className="flex h-9 [@media(pointer:coarse)]:h-11 items-center gap-3 px-4 text-xs text-fg-secondary">
        <p className="min-w-0 flex-1 truncate">{chapter}</p>
        <div
          ref={mount}
          hidden={!slots["toolbar-status"]}
          className="lines-1 min-w-0 max-w-[60%] overflow-hidden whitespace-nowrap"
        />
        {!slots["toolbar-status"] && (
          <div className="flex min-w-0 max-w-[80%] items-center gap-2 tabular-nums">
            {index && locator && (
              <span className="truncate">
                {linear === false
                  ? "Outside the reading order"
                  : pageText(locator, index)}
              </span>
            )}
            {percent !== null && <span className="shrink-0">{percent}%</span>}
            {linear !== false && timeLeftChapter && (
              <span className="min-w-0 truncate">{timeLeftChapter}</span>
            )}
          </div>
        )}
      </div>
      {index && locator && onScrub && (
        <div className="flex items-center gap-2 px-4 pb-1">
          <ProgressScrubber
            fraction={locator.totalProgression}
            index={index}
            onCommit={onScrub}
            onPeek={onPeek}
          />
          {onGoTo && (
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                onGoTo();
              }}
              aria-label="Go to"
              data-tooltip="Go to"
              data-tooltip-keys="g"
              className="action-icon-sm"
            >
              <Hash className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          {onRunningLines && (
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                onRunningLines();
              }}
              aria-label="Header and footer"
              data-tooltip="Header and footer"
              className="action-icon-sm"
            >
              <PanelBottom className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}
    </footer>
  );
}
