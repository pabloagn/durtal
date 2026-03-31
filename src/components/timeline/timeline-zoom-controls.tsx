"use client";

import { RotateCcw } from "lucide-react";

interface TimelineZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

const buttonBase =
  "flex h-7 w-7 items-center justify-center text-fg-secondary " +
  "hover:bg-bg-tertiary/60 hover:text-fg-primary " +
  "active:bg-bg-tertiary/80 " +
  "transition-colors duration-100 " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-rose";

export function TimelineZoomControls({
  onZoomIn,
  onZoomOut,
  onReset,
}: TimelineZoomControlsProps) {
  return (
    <div
      style={{ borderRadius: "var(--radius-sm)" }}
      className={
        "flex flex-col overflow-hidden " +
        "border border-glass-border bg-bg-secondary/90 " +
        "divide-y divide-glass-border"
      }
    >
      <button
        type="button"
        className={buttonBase}
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <span className="text-xs leading-none select-none" aria-hidden>+</span>
      </button>

      <button
        type="button"
        className={buttonBase}
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <span className="text-xs leading-none select-none" aria-hidden>−</span>
      </button>

      <button
        type="button"
        className={buttonBase}
        onClick={onReset}
        aria-label="Reset view"
        title="Reset view"
      >
        <RotateCcw size={12} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}
