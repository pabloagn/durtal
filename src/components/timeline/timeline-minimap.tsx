"use client";

import { useRef, useCallback, type PointerEvent } from "react";

interface TimelineMinimapProps {
  minYear: number;
  maxYear: number;
  viewportMinYear: number;
  viewportMaxYear: number;
  onNavigate: (centerYear: number) => void;
  items?: Array<{ year: number }>;
}

const HEIGHT = 28;
const INDICATOR_MIN_WIDTH = 8;

export function TimelineMinimap({
  minYear,
  maxYear,
  viewportMinYear,
  viewportMaxYear,
  onNavigate,
  items,
}: TimelineMinimapProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);

  const totalSpan = maxYear - minYear || 1;

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

  /** Convert an X position within the track to a year */
  const xToYear = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return (minYear + maxYear) / 2;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return minYear + ratio * totalSpan;
    },
    [minYear, maxYear, totalSpan],
  );

  // ── Drag on the viewport indicator ───────────────────────────────────────

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      isDragging.current = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      const year = xToYear(e.clientX);
      onNavigate(year);
    },
    [xToYear, onNavigate],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      isDragging.current = false;
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    },
    [],
  );

  // Click anywhere on the track to jump
  const onTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDragging.current) return;
      const year = xToYear(e.clientX);
      onNavigate(year);
    },
    [xToYear, onNavigate],
  );

  // ── Compute indicator position as percentages ─────────────────────────────

  const vpStart = clamp((viewportMinYear - minYear) / totalSpan, 0, 1);
  const vpEnd = clamp((viewportMaxYear - minYear) / totalSpan, 0, 1);
  // expressed as percentages for the absolutely positioned child
  const leftPct = vpStart * 100;
  const widthPct = Math.max(
    (vpEnd - vpStart) * 100,
    (INDICATOR_MIN_WIDTH / (trackRef.current?.clientWidth ?? 200)) * 100,
  );

  // ── Item density dots ─────────────────────────────────────────────────────

  const dots =
    items?.map((item, i) => {
      const ratio = (item.year - minYear) / totalSpan;
      if (ratio < 0 || ratio > 1) return null;
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${ratio * 100}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 2,
            height: 2,
            borderRadius: "50%",
            backgroundColor: "var(--color-fg-muted)",
            opacity: 0.6,
          }}
        />
      );
    }) ?? null;

  return (
    <div
      style={{
        height: HEIGHT,
        position: "relative",
        cursor: "pointer",
        userSelect: "none",
      }}
      className="border-t border-glass-border bg-bg-secondary/80"
      onClick={onTrackClick}
      role="scrollbar"
      aria-label="Timeline minimap"
      aria-orientation="horizontal"
      aria-valuenow={Math.round((viewportMinYear + viewportMaxYear) / 2)}
      aria-valuemin={minYear}
      aria-valuemax={maxYear}
    >
      {/* Track container */}
      <div
        ref={trackRef}
        style={{ position: "absolute", inset: "4px 8px" }}
      >
        {/* Item density dots */}
        {dots}

        {/* Viewport indicator */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            backgroundColor: "var(--color-accent-rose)",
            opacity: 0.35,
            borderRadius: "var(--radius-sm)",
            cursor: "grab",
            minWidth: INDICATOR_MIN_WIDTH,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
