"use client";
import { useCallback, useSyncExternalStore } from "react";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { DurtalLocator } from "@/lib/reader/engine";
import type { PositionIndex } from "@/lib/reader/position-index";
import { pageText } from "@/lib/reader/running-lines";
import { ProgressScrubber } from "./progress-scrubber";
import { focusOpener } from "./reader-bar-item";
import { Hash, PanelBottom } from "lucide-react";
import { formatPercent, samePlace } from "@/lib/reader/place-label";

/**
 * The reader's bottom bar (eBooks sub-issue 3): the chapter and how far
 * through the book. Shows and hides with the top bar; hidden, it is inert,
 * and a thin line along the bottom edge keeps how far you are (SLN-663).
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
  quietChapter = false,
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
  /** No running lines name the chapter (scrolled text, PDFs, comics): it
   * stays beside the line while the bars are hidden */
  quietChapter?: boolean;
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
  const place =
    index && locator
      ? linear === false
        ? "Outside the reading order"
        : pageText(locator, index)
      : null;
  // A comic's contents name its pages, so its chapter is its page: say it once
  const heading = chapter && !(place && samePlace(chapter, place)) ? chapter : null;
  return (
    <>
    {percent !== null && (
      <div
        data-reader-progress-line
        aria-hidden
        className={`pointer-events-none fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] z-30 h-0.5 transition-opacity duration-150 motion-reduce:transition-none ${
          visible ? "opacity-0" : ""
        }`}
      >
        <div className="h-full bg-fg-muted" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    )}
    {quietChapter && heading && (
      // Laid out like the bar, so the chapter sits where the bar shows it
      <div
        data-reader-quiet-chapter
        aria-hidden
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-30 border-t border-transparent pb-[env(safe-area-inset-bottom)] transition-opacity duration-150 motion-reduce:transition-none ${
          visible ? "opacity-0" : ""
        }`}
      >
        <div className="flex h-9 [@media(pointer:coarse)]:h-11 items-center px-4 text-xs text-fg-secondary">
          <p className="min-w-0 flex-1 truncate">{heading}</p>
        </div>
        {onScrub && <div className="min-h-8 pb-1 pointer-coarse:min-h-12" />}
      </div>
    )}
    <footer
      data-reader-bottom-bar
      data-reader-chrome
      data-reader-index={index?.complete ? "ready" : "pending"}
      inert={!visible}
      className={`glass-bar fixed inset-x-0 bottom-0 z-30 border-t border-glass-border pb-[env(safe-area-inset-bottom)] transition-opacity duration-150 motion-reduce:transition-none ${
        visible ? "" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="flex h-9 [@media(pointer:coarse)]:h-11 items-center gap-3 px-4 text-xs text-fg-secondary">
        <p className="min-w-0 flex-1 truncate">{heading}</p>
        {/* The tracking control: a whole button, never clipped to the row's text */}
        <div
          ref={mount}
          hidden={!slots["toolbar-status"]}
          className="flex min-w-0 max-w-[40%] shrink-0 items-center overflow-hidden whitespace-nowrap [&_button]:max-w-full [&_button]:truncate"
        />
        {/* The place shows beside the tracking control too, never instead of it */}
        <div className="flex min-w-0 max-w-[60%] items-center gap-2 tabular-nums">
          {/* The place is never cut ("p. 2…" at 320); the time left gives way */}
          {place && <span className="shrink-0 whitespace-nowrap">{place}</span>}
          {percent !== null && <span className="shrink-0">{formatPercent(percent)}</span>}
          {linear !== false && timeLeftChapter && (
            <span className="min-w-0 truncate">{timeLeftChapter}</span>
          )}
        </div>
      </div>
      {/* The row keeps its height before the book's positions are ready, so
          the room the text keeps clear of the bar never changes (SLN-663) */}
      {onScrub && (
        <div className="flex min-h-8 items-center gap-2 px-4 pb-1 pointer-coarse:min-h-12">
          {index && locator && (
          <>
          <ProgressScrubber
            fraction={locator.totalProgression}
            restLabel={[heading, place, percent !== null ? formatPercent(percent) : null]
              .filter(Boolean)
              .join(" · ")}
            index={index}
            onCommit={onScrub}
            onPeek={onPeek}
          />
          {onGoTo && (
            <button
              type="button"
              onClick={(event) => {
                focusOpener(event);
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
                focusOpener(event);
                onRunningLines();
              }}
              aria-label="Header and footer"
              data-tooltip="Header and footer"
              className="action-icon-sm"
            >
              <PanelBottom className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          </>
          )}
        </div>
      )}
    </footer>
    </>
  );
}
