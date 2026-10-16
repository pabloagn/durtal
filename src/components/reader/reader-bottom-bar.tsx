"use client";
import { useCallback, useSyncExternalStore } from "react";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { DurtalLocator } from "@/lib/reader/engine";
import type { PositionIndex } from "@/lib/reader/position-index";
import { pageText } from "@/lib/reader/running-lines";
import { ProgressScrubber } from "./progress-scrubber";
import { focusOpener } from "./reader-bar-item";
import { FitWords } from "./fit-words";
import { Hash, PanelBottom } from "lucide-react";
import { formatPercent, samePlace } from "@/lib/reader/place-label";
import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import { themeColours } from "@/lib/reader/presentation/themes";

/** How far scrolled text fades into the top edge: `h-6` on the fade */
export const QUIET_TOP_FADE_PX = 24;

export type QuietChapter = { background: string; text: string; topFade: boolean };

/**
 * Scrolled reflowable text has no running lines to name the chapter, so while
 * the bars are hidden it stays in a slim band at the foot of the screen, and
 * the text fades into the top edge. Page-by-page books (PDFs, comics, fixed
 * layout) keep the whole page and show the chapter in the bars only, as a band
 * there would sit over the page's foot. Kept bars name the chapter themselves.
 */
export function quietChapter({ policy, paginated, pageByPage, pinBars, format }: {
  policy: ReaderPresentation | null | undefined;
  paginated: boolean;
  pageByPage: boolean;
  pinBars: boolean;
  format: string | undefined;
}): QuietChapter | null {
  if (!policy || paginated || pageByPage || pinBars) return null;
  const { background, text } = themeColours(policy);
  return { background, text, topFade: format === "epub" && policy.flow === "scrolled" };
}

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
  quiet = null,
  placeFrom = null,
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
  /** The chapter's band while the bars are hidden: see `quietChapter` */
  quiet?: QuietChapter | null;
  /** The device whose place the book opened at: named for a moment where the
   * chapter sits, so it covers no text (SLN-729) */
  placeFrom?: string | null;
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
    {/* Outside the bar, which is inert while hidden: the place is announced either way */}
    <p role="status" aria-live="polite" className="sr-only">
      {placeFrom ? `Your place from ${placeFrom}` : ""}
    </p>
    {percent !== null && (
      <div
        data-reader-progress-line
        aria-hidden
        className={`pointer-events-none fixed inset-x-reader bottom-[env(safe-area-inset-bottom)] z-30 h-0.5 transition-opacity duration-150 motion-reduce:transition-none ${
          visible ? "opacity-0" : ""
        }`}
      >
        <div className="h-full bg-fg-muted" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    )}
    {quiet?.topFade && (
      <div
        data-reader-top-fade
        aria-hidden
        className="pointer-events-none fixed inset-x-reader top-0 z-20 h-6"
        style={{ background: `linear-gradient(to top, transparent, ${quiet.background})` }}
      />
    )}
    {quiet && heading && (
      // The text fades out over 24px above the chapter's own row
      <div
        data-reader-quiet-chapter
        aria-hidden
        className={`pointer-events-none fixed inset-x-reader bottom-0 z-20 pt-6 pb-[env(safe-area-inset-bottom)] transition-opacity duration-150 motion-reduce:transition-none ${
          visible ? "opacity-0" : ""
        }`}
        style={{
          background: `linear-gradient(to bottom, transparent, ${quiet.background} 24px)`,
          color: `color-mix(in srgb, ${quiet.text} 70%, ${quiet.background})`,
        }}
      >
        <div className="flex h-9 [@media(pointer:coarse)]:h-11 items-center justify-center px-4 text-xs">
          <p className="min-w-0 max-w-[720px]"><FitWords text={heading} /></p>
        </div>
      </div>
    )}
    <footer
      data-reader-bottom-bar
      data-reader-chrome
      data-reader-index={index?.complete ? "ready" : "pending"}
      inert={!visible}
      className={`glass-bar fixed inset-x-reader bottom-0 z-30 border-t border-glass-border pb-[env(safe-area-inset-bottom)] transition-opacity duration-150 motion-reduce:transition-none ${
        visible ? "" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="flex h-9 [@media(pointer:coarse)]:h-11 items-center gap-3 px-4 text-xs text-fg-secondary">
        {placeFrom ? (
          // One line at 320: the short form under 480px, and the tracking
          // control and time left give it their room while it shows. Whole
          // words only, like the chapter (SLN-729, SLN-730)
          <p data-reader-place-from aria-hidden className="min-w-0 flex-1">
            <FitWords className="max-[480px]:hidden" text={`Your place from ${placeFrom}`} />
            <FitWords className="min-[480px]:hidden" text={`From ${placeFrom}`} />
          </p>
        ) : (
          // Whole words only, and nothing when not one fits (SLN-730)
          <p className="min-w-0 flex-1">{heading && <FitWords text={heading} />}</p>
        )}
        {/* The tracking control: a whole button, never clipped to the row's text */}
        <div
          ref={mount}
          hidden={!slots["toolbar-status"] || !!placeFrom}
          className="flex shrink-0 items-center whitespace-nowrap"
        />
        {/* The place shows beside the tracking control too, never instead of it */}
        <div className="flex min-w-0 max-w-[60%] items-center gap-2 tabular-nums">
          {/* The place is never cut ("p. 2…" at 320); the time left gives way whole */}
          {place && <span className="shrink-0 whitespace-nowrap">{place}</span>}
          {/* Under 480px the percent gives "From iPhone · Safari" its room while it shows */}
          {percent !== null && (
            <span className={`shrink-0${placeFrom ? " max-[480px]:hidden" : ""}`}>
              {formatPercent(percent)}
            </span>
          )}
          {linear !== false && timeLeftChapter && !placeFrom && (
            <FitWords whole text={timeLeftChapter} />
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
