"use client";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { ReaderPlace } from "@/lib/reader/sync/places";
import { formatRelativeTime } from "@/lib/utils/relative-time";

export function resumeNoticeText(place: ReaderPlace, fileId: string): string {
  const locator = place.locator;
  const percent = Math.round(locator.totalProgression * 100);
  const position =
    place.fileId !== fileId
      ? `About ${percent}%`
      : locator.pageLabel
        ? `Page ${locator.pageLabel}`
        : `${percent}%${place.chapter ? ` · ${place.chapter}` : ""}`;
  return `${position} · read on ${place.deviceLabel.split(" · ")[0]} · ${formatRelativeTime(place.clientUpdatedAt)}`;
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
