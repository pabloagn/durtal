"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The page turn buttons for a mouse (SLN-662). A click in the text never
 * turns the page, so a mouse turns with the keys, the wheel or these: one
 * quiet chevron at each edge of the viewport, outside the text column. They
 * show and hide with the bars, and are not there for touch, which swipes.
 * Left and right follow the book's direction, as the arrow keys do.
 */
export function PageEdges({
  visible,
  dir,
  onLeft,
  onRight,
}: {
  visible: boolean;
  dir: "ltr" | "rtl";
  onLeft(): void;
  onRight(): void;
}) {
  const [left, right] =
    dir === "rtl"
      ? ["Next page", "Previous page"]
      : ["Previous page", "Next page"];
  const edge = `action-icon fixed top-1/2 z-20 -translate-y-1/2 transition-opacity duration-150 motion-reduce:transition-none pointer-coarse:hidden ${
    visible ? "" : "pointer-events-none opacity-0"
  }`;
  return (
    <div data-reader-chrome data-reader-page-edges inert={!visible}>
      <button
        type="button"
        aria-label={left}
        data-tooltip={left}
        data-tooltip-keys="←"
        onClick={onLeft}
        className={`${edge} left-2`}
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label={right}
        data-tooltip={right}
        data-tooltip-keys="→"
        onClick={onRight}
        className={`${edge} right-2`}
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
