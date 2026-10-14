"use client";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { DurtalLocator } from "@/lib/reader/engine";
import type { ReaderPlace } from "@/lib/reader/sync/places";
import { formatRelativeTime } from "@/lib/utils/relative-time";
import type { PositionIndex } from "@/lib/reader/position-index";
import { formatPercent, fractionPercent, pageWords } from "@/lib/reader/place-label";

/** Where a saved place is: its page, else its share of the book and chapter (SLN-680: as the bar names it) */
export function resumePlaceLabel(place: ReaderPlace, fileId: string, index?: PositionIndex | null): string {
  const locator = place.locator;
  const percent = fractionPercent(locator.totalProgression);
  if (place.fileId !== fileId) return `About ${percent}`;
  const page = index ? index.firstPage(locator) : locator.pageLabel;
  return page
    ? index ? index.pageWords(page) : pageWords(page, undefined)
    : `${percent}${place.chapter ? ` · ${place.chapter}` : ""}`;
}

/** How far the other place is from this one, in pages when both have numbered pages */
function placeDistance(place: ReaderPlace, fileId: string, here: DurtalLocator | null, index?: PositionIndex | null): string | null {
  if (!here || place.fileId !== fileId) return null;
  const page = (locator: DurtalLocator) => {
    const label = index ? index.firstPage(locator) : locator.pageLabel;
    return label && /^\d+$/.test(label) ? Number(label) : null;
  };
  const there = page(place.locator), mine = page(here);
  if (there !== null && mine !== null) {
    const amount = there - mine;
    if (amount === 0) return null;
    return `${Math.abs(amount)}${Math.abs(amount) === 1 ? " page" : " pages"} ${amount < 0 ? "behind" : "ahead of"} you`;
  }
  const amount = (place.locator.totalProgression - here.totalProgression) * 100;
  const words = formatPercent(Math.abs(amount));
  if (words === "0%") return null;
  return `${words} ${amount < 0 ? "behind" : "ahead of"} you`;
}

/** The other device's place, how far it is from yours, and the device with its browser (SLN-686) */
export function resumeNoticeText(place: ReaderPlace, fileId: string, here: DurtalLocator | null = null, index: PositionIndex | null = null): string {
  const distance = placeDistance(place, fileId, here, index);
  return [resumePlaceLabel(place, fileId, index), distance, place.deviceLabel, formatRelativeTime(place.clientUpdatedAt)]
    .filter(Boolean).join(" · ");
}
export function ReaderNotice({
  bridge,
  children,
}: {
  bridge: ReaderBridgeController;
  children?: ReactNode;
}) {
  const slots = useSyncExternalStore(
    bridge.subscribeSlots,
    bridge.getSlots,
    bridge.getSlots,
  );
  const mount = useCallback(
    (element: HTMLDivElement | null) => bridge.mountSlot("top-bar", element),
    [bridge],
  );
  return (
    <div
      role="status"
      aria-live="polite"
      data-reader-chrome
      hidden={!children && !slots["top-bar"]}
      className="glass fixed left-1/2 top-[calc(48px_+_env(safe-area-inset-top)_+_8px)] pointer-coarse:top-[calc(56px_+_env(safe-area-inset-top)_+_8px)] z-40 w-[calc(100%_-_32px)] max-w-[560px] -translate-x-1/2 overflow-hidden px-3 py-2 text-sm text-fg-secondary"
    >
      {children}
      <div
        ref={mount}
        hidden={!!children}
        className="flex min-w-0 items-center gap-2"
      />
    </div>
  );
}
