"use client";
import { Undo2, Redo2 } from "lucide-react";
import type { ReaderNavigation } from "@/lib/reader/navigation";
import type { PositionIndex } from "@/lib/reader/position-index";
export function ReturnChip({
  navigation,
  index,
  visible,
  onStep,
}: {
  navigation: ReaderNavigation;
  index: PositionIndex;
  visible: boolean;
  onStep(direction: -1 | 1): void;
}) {
  const { back, forward } = navigation.history;
  if (!back && !forward) return null;
  const primary = forward ?? back!;
  const direction = forward ? 1 : -1;
  const label =
    (direction > 0 ? "Forward to " : "Back to ") +
    index.locatorLabel(primary.locator);
  return (
    <div
      data-reader-chrome
      hidden={!visible}
      className="glass fixed bottom-20 left-4 z-30 flex max-w-[calc(100vw-32px)] items-center gap-1 p-1 text-sm"
    >
      <button
        type="button"
        disabled={navigation.busy}
        aria-label={label}
        data-tooltip={direction > 0 ? "Forward" : "Back"}
        data-tooltip-keys={direction > 0 ? "alt right" : "alt left"}
        onClick={() => onStep(direction)}
        className="flex min-h-8 min-w-8 items-center gap-2 rounded-sm px-2 hover:bg-bg-tertiary pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        {direction > 0 ? (
          <Redo2 className="h-4 w-4 shrink-0" strokeWidth={1.5} />
        ) : (
          <Undo2 className="h-4 w-4 shrink-0" strokeWidth={1.5} />
        )}
        <span className="truncate">{label}</span>
      </button>
      {forward && back && (
        <button
          type="button"
          disabled={navigation.busy}
          aria-label={"Back to " + index.locatorLabel(back.locator)}
          data-tooltip="Back"
          data-tooltip-keys="alt left"
          onClick={() => onStep(-1)}
          className="flex min-h-8 min-w-8 items-center justify-center rounded-sm px-2 hover:bg-bg-tertiary pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <Undo2 className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
