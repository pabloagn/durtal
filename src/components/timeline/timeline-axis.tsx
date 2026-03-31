"use client";

import { useMemo } from "react";
import type { TimelineTransform } from "./use-timeline-transform";

interface TimelineAxisProps {
  minYear: number;
  maxYear: number;
  transform: TimelineTransform;
  pixelsPerYear: number;
  containerWidth: number;
}

/** Return the world-space X position for a given year. */
function yearToWorld(year: number, minYear: number, pixelsPerYear: number): number {
  return (year - minYear) * pixelsPerYear;
}

/** Convert world-space X to screen-space X given the current transform. */
function worldToScreen(worldX: number, transform: TimelineTransform): number {
  return worldX * transform.scale + transform.offsetX;
}

function screenToWorld(screenX: number, transform: TimelineTransform, pixelsPerYear: number, minYear: number): number {
  const worldX = (screenX - transform.offsetX) / transform.scale;
  return worldX / pixelsPerYear + minYear;
}

// Round a year down to the nearest multiple of `interval`
function floorTo(year: number, interval: number): number {
  return Math.floor(year / interval) * interval;
}

// Round a year up to the nearest multiple of `interval`
function ceilTo(year: number, interval: number): number {
  return Math.ceil(year / interval) * interval;
}

/** Ordinal suffix for a century number (1 → "st", 2 → "nd", 3 → "rd", N → "th") */
function centuryOrdinal(n: number): string {
  const abs = Math.abs(n);
  if (abs % 100 === 11 || abs % 100 === 12 || abs % 100 === 13) return "th";
  switch (abs % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

/**
 * Format a year for display.
 *  – Negative years: "3,000 BCE", "500 BCE"
 *  – Year 0: "0"
 *  – Years 1–499: "100 CE", "450 CE"
 *  – Years 500+: plain "1850", "2024"
 */
function formatYear(year: number): string {
  if (year === 0) return "0";
  if (year < 0) {
    const abs = Math.abs(year);
    return abs >= 1000
      ? `${abs.toLocaleString("en-US")} BCE`
      : `${abs} BCE`;
  }
  if (year < 500) return `${year} CE`;
  return String(year);
}

/**
 * Format a century label: e.g. year 1200 → "13th c.", year -300 → "4th c. BCE",
 * year 0 → "1st c. CE"
 */
function formatCentury(year: number): string {
  if (year === 0) {
    return "1st c. CE";
  }
  if (year > 0) {
    const centuryNum = Math.floor(year / 100) + 1;
    const suf = centuryOrdinal(centuryNum);
    const label = `${centuryNum}${suf} c.`;
    return year < 500 ? `${label} CE` : label;
  }
  // BCE: year -300 is in the "3rd c. BCE" (300–201 BCE)
  const centuryNum = Math.ceil(Math.abs(year) / 100);
  const suf = centuryOrdinal(centuryNum);
  return `${centuryNum}${suf} c. BCE`;
}

// ── Fixed axis header height ──────────────────────────────────────────────────

export const AXIS_HEADER_HEIGHT = 52;

export function TimelineAxis({
  minYear,
  maxYear,
  transform,
  pixelsPerYear,
  containerWidth,
}: TimelineAxisProps) {
  const showDecades = transform.scale > 0.5;
  const showYears = transform.scale > 3;

  // Compute the visible year range with a small margin
  const visibleMinYear = useMemo(
    () => screenToWorld(-40, transform, pixelsPerYear, minYear),
    [transform, pixelsPerYear, minYear],
  );
  const visibleMaxYear = useMemo(
    () => screenToWorld(containerWidth + 40, transform, pixelsPerYear, minYear),
    [transform, pixelsPerYear, minYear, containerWidth],
  );

  // Clamp to data range
  const rangeMin = Math.max(minYear, Math.floor(visibleMinYear));
  const rangeMax = Math.min(maxYear, Math.ceil(visibleMaxYear));

  // ── Century ticks ─────────────────────────────────────────────────────────
  const centuryTicks = useMemo(() => {
    const ticks: number[] = [];
    const start = floorTo(rangeMin, 100);
    const end = ceilTo(rangeMax, 100);
    for (let y = start; y <= end; y += 100) {
      ticks.push(y);
    }
    return ticks;
  }, [rangeMin, rangeMax]);

  // ── Decade ticks ──────────────────────────────────────────────────────────
  const decadeTicks = useMemo(() => {
    if (!showDecades) return [];
    const ticks: number[] = [];
    const start = floorTo(rangeMin, 10);
    const end = ceilTo(rangeMax, 10);
    for (let y = start; y <= end; y += 10) {
      if (y % 100 !== 0) ticks.push(y); // centuries handled separately
    }
    return ticks;
  }, [rangeMin, rangeMax, showDecades]);

  // ── Year ticks ────────────────────────────────────────────────────────────
  const yearTicks = useMemo(() => {
    if (!showYears) return [];
    const ticks: number[] = [];
    const start = Math.floor(rangeMin);
    const end = Math.ceil(rangeMax);
    for (let y = start; y <= end; y += 1) {
      if (y % 10 !== 0) ticks.push(y); // decades/centuries handled separately
    }
    return ticks;
  }, [rangeMin, rangeMax, showYears]);

  // The baseline sits at the bottom of the header strip
  const axisY = AXIS_HEADER_HEIGHT - 8;
  // Century label sits near the middle of the strip
  const centuryLabelY = AXIS_HEADER_HEIGHT - 26;
  // Small tick/decade label row
  const decadeLabelY = AXIS_HEADER_HEIGHT - 12;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        left: 0,
        right: 0,
        height: AXIS_HEADER_HEIGHT,
        backgroundColor: "var(--color-bg-primary)",
        borderBottom: "1px solid var(--color-glass-border)",
        zIndex: 20,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          pointerEvents: "none",
        }}
        aria-hidden
      >
        {/* ── Century gridlines + labels ────────────────────────────────── */}
        {centuryTicks.map((year) => {
          const worldX = yearToWorld(year, minYear, pixelsPerYear);
          const screenX = worldToScreen(worldX, transform);
          // Skip off-screen
          if (screenX < -20 || screenX > containerWidth + 20) return null;

          return (
            <g key={`century-${year}`}>
              {/* Tick mark at bottom of axis */}
              <line
                x1={screenX}
                y1={axisY - 8}
                x2={screenX}
                y2={axisY}
                stroke="var(--color-glass-border)"
                strokeWidth={1}
              />
              {/* Century label — primary, serif, prominent */}
              <text
                x={screenX + 4}
                y={centuryLabelY}
                fill="var(--color-fg-primary)"
                fontSize="14"
                fontFamily="var(--font-serif)"
                fontWeight="600"
                style={{ userSelect: "none" }}
              >
                {formatCentury(year)}
              </text>
              {/* Year number below the century label */}
              <text
                x={screenX + 4}
                y={axisY - 2}
                fill="var(--color-fg-secondary)"
                fontSize="12"
                fontFamily="var(--font-mono)"
                opacity={0.8}
                style={{ userSelect: "none" }}
              >
                {formatYear(year)}
              </text>
            </g>
          );
        })}

        {/* ── Decade gridlines + labels ──────────────────────────────────── */}
        {decadeTicks.map((year) => {
          const worldX = yearToWorld(year, minYear, pixelsPerYear);
          const screenX = worldToScreen(worldX, transform);
          if (screenX < -20 || screenX > containerWidth + 20) return null;

          return (
            <g key={`decade-${year}`}>
              <line
                x1={screenX}
                y1={axisY - 4}
                x2={screenX}
                y2={axisY}
                stroke="var(--color-glass-border)"
                strokeWidth={0.5}
                strokeDasharray="2 4"
              />
              <text
                x={screenX + 3}
                y={decadeLabelY}
                fill="var(--color-fg-muted)"
                fontSize="11"
                fontFamily="var(--font-sans)"
                style={{ userSelect: "none" }}
              >
                {formatYear(year)}
              </text>
            </g>
          );
        })}

        {/* ── Individual year ticks ─────────────────────────────────────── */}
        {yearTicks.map((year) => {
          const worldX = yearToWorld(year, minYear, pixelsPerYear);
          const screenX = worldToScreen(worldX, transform);
          if (screenX < -20 || screenX > containerWidth + 20) return null;

          return (
            <g key={`year-${year}`}>
              <line
                x1={screenX}
                y1={axisY - 2}
                x2={screenX}
                y2={axisY}
                stroke="var(--color-glass-border)"
                strokeWidth={0.5}
                opacity={0.5}
              />
              <text
                x={screenX + 2}
                y={decadeLabelY}
                fill="var(--color-fg-muted)"
                fontSize="9"
                fontFamily="var(--font-sans)"
                opacity={0.7}
                style={{ userSelect: "none" }}
              >
                {formatYear(year)}
              </text>
            </g>
          );
        })}

        {/* ── Axis baseline ─────────────────────────────────────────────── */}
        <line
          x1={0}
          y1={axisY}
          x2={containerWidth}
          y2={axisY}
          stroke="var(--color-glass-border)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
