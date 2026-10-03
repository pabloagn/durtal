"use client";

import { useState, useCallback, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { WorkTimelineItem } from "@/lib/actions/work-timeline";
import { mediaImageStyle } from "@/lib/utils/media-style";

// ── Constants ────────────────────────────────────────────────────────────────

const DIAMOND_SIZE_BASE = 10;
const DIAMOND_SIZE_HOVER = 14;
const COVER_W = 20;
const COVER_H = 28;
const EDITION_DOT_SIZE = 5;

/** A 12px label on a 15px line: the title above the cover, the author below */
const LABEL_H = 15;

/**
 * A label is as wide as the room to the nearest marker in its lane allows,
 * less a gap, from 72 to 128px; with less room it is hidden. Two labels in a
 * lane are then always LABEL_GAP apart or more. Lanes keep markers LABEL_ROOM
 * apart at scale 1, so every label shows there.
 */
const LABEL_GAP = 8;
const LABEL_MIN_W = 72;
const LABEL_MAX_W = 128;
export const LABEL_ROOM = LABEL_MIN_W + LABEL_GAP;

/** Label width for a marker whose nearest lane neighbor is `room` px away */
export function labelWidth(room: number): number {
  return Math.min(LABEL_MAX_W, room - LABEL_GAP);
}

// Top to bottom inside the lane: title, cover, diamond, author
const COVER_TOP = LABEL_H + 3;
const DIAMOND_CY = COVER_TOP + COVER_H + 4 + DIAMOND_SIZE_BASE / 2;
const AUTHOR_TOP = DIAMOND_CY + DIAMOND_SIZE_BASE / 2 + 5;

export const MARKER_LANE_HEIGHT = AUTHOR_TOP + LABEL_H;

// ── Props ────────────────────────────────────────────────────────────────────

export interface WorkTimelineMarkerProps {
  work: WorkTimelineItem;
  /** Screen-space X of the work's originalYear */
  x: number;
  /** Screen-space Y (lane centre) */
  y: number;
  /** Current timeline scale (from useTimelineTransform) */
  scale: number;
  /** Width of the title and author labels, from `labelWidth` */
  labelW: number;
  isHovered: boolean;
  /** Called with (id, clientX, clientY) on hover, or (null) on leave */
  onHover: (id: string | null, clientX?: number, clientY?: number) => void;
  /** pixels-per-year already multiplied by scale */
  scaledPixelsPerYear: number;
}

// ── Component ────────────────────────────────────────────────────────────────

export function WorkTimelineMarker({
  work,
  x,
  y,
  scale,
  labelW,
  isHovered,
  onHover,
  scaledPixelsPerYear,
}: WorkTimelineMarkerProps) {
  const router = useRouter();
  const [imgError, setImgError] = useState(false);

  const labelsFit = labelW >= LABEL_MIN_W;
  const showCover = scale > 0.3;
  const showAuthor = scale > 0.5 && labelsFit;
  const showTitle = scale > 0.8 && labelsFit;
  const showEditions = scale > 0.8;

  const diamondSize = isHovered ? DIAMOND_SIZE_HOVER : DIAMOND_SIZE_BASE;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      router.push(`/library/${work.slug}`);
    },
    [router, work.slug],
  );

  // The container is 80px wide, centred on x, and spans the lane
  const containerStyle: CSSProperties = {
    position: "absolute",
    transform: `translate3d(${x - 40}px, ${y - MARKER_LANE_HEIGHT / 2}px, 0)`,
    width: 80,
    height: MARKER_LANE_HEIGHT,
    cursor: "pointer",
    pointerEvents: "all",
    userSelect: "none",
    zIndex: isHovered ? 20 : 5,
  };

  // Diamond centre within the 80px container
  const diamondCX = 40;

  const diamondStyle: CSSProperties = {
    position: "absolute",
    left: diamondCX - diamondSize / 2,
    top: DIAMOND_CY - diamondSize / 2,
    width: diamondSize,
    height: diamondSize,
    backgroundColor: "var(--color-accent-gold)",
    border: "1px solid rgba(193,198,196,0.15)",
    transform: "rotate(45deg)",
    transition:
      "width 120ms ease, height 120ms ease, left 120ms ease, top 120ms ease",
    boxShadow: isHovered
      ? "0 0 8px 2px rgba(192,163,110,0.45), 0 0 2px 1px rgba(192,163,110,0.6)"
      : undefined,
  };

  const coverStyle: CSSProperties = {
    position: "absolute",
    left: diamondCX - COVER_W / 2,
    top: COVER_TOP,
    width: COVER_W,
    height: COVER_H,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "var(--color-bg-tertiary)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
    pointerEvents: "none",
  };

  // Title above the cover, author below the diamond
  const labelStyle = (top: number): CSSProperties => ({
    position: "absolute",
    left: diamondCX - labelW / 2,
    width: labelW,
    top,
    lineHeight: `${LABEL_H}px`,
    pointerEvents: "none",
  });

  return (
    <div
      style={containerStyle}
      onPointerEnter={(e) => onHover(work.id, e.clientX, e.clientY)}
      onPointerLeave={() => onHover(null)}
      onPointerMove={(e) => {
        if (isHovered) onHover(work.id, e.clientX, e.clientY);
      }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`${work.title} (${work.originalYear})`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/library/${work.slug}`);
        }
      }}
    >
      {/* Title */}
      {showTitle && (
        <span
          className="truncate text-center font-serif text-micro text-fg-primary"
          style={labelStyle(0)}
        >
          {work.title}
        </span>
      )}

      {/* Book cover */}
      {showCover && (
        <div style={coverStyle}>
          {work.coverUrl && !imgError ? (
            <img
              src={work.coverUrl}
              alt={work.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                ...mediaImageStyle(work.coverCrop),
              }}
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--color-bg-tertiary)",
              }}
            >
              <span className="font-serif text-micro leading-none text-fg-secondary">
                {work.title[0]}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Diamond */}
      <div style={diamondStyle} />

      {/* Edition dots extending to the right */}
      {showEditions && work.editions.length > 0 && (
        <svg
          style={{
            position: "absolute",
            left: diamondCX,
            top: 0,
            width: 200,
            height: MARKER_LANE_HEIGHT,
            overflow: "visible",
            pointerEvents: "none",
          }}
          aria-hidden
        >
          {/* Horizontal connecting line */}
          {work.editions.length > 1 && (
            <line
              x1={diamondSize / 2}
              y1={DIAMOND_CY}
              x2={(() => {
                const maxYr = work.editions.reduce<number>((max, e) => {
                  const yr = e.publicationYear ?? work.originalYear;
                  return yr > max ? yr : max;
                }, work.originalYear);
                return (maxYr - work.originalYear) * scaledPixelsPerYear + EDITION_DOT_SIZE / 2;
              })()}
              y2={DIAMOND_CY}
              stroke="rgba(88,110,117,0.2)"
              strokeWidth={1}
            />
          )}

          {/* Edition dots */}
          {work.editions.map((edition) => {
            const yr = edition.publicationYear ?? work.originalYear;
            const offsetX = (yr - work.originalYear) * scaledPixelsPerYear;
            if (offsetX < 0) return null;
            return (
              <circle
                key={edition.id}
                cx={offsetX + EDITION_DOT_SIZE / 2}
                cy={DIAMOND_CY}
                r={EDITION_DOT_SIZE / 2}
                fill="rgba(88,110,117,0.5)"
              />
            );
          })}
        </svg>
      )}

      {/* Author */}
      {showAuthor && (
        <span
          className="truncate text-center font-sans text-micro text-fg-secondary"
          style={labelStyle(AUTHOR_TOP)}
        >
          {work.authorName}
        </span>
      )}
    </div>
  );
}
