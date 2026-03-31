"use client";

import { useState, useCallback, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { WorkTimelineItem } from "@/lib/actions/work-timeline";

// ── Constants ────────────────────────────────────────────────────────────────

const DIAMOND_SIZE_BASE = 10;
const DIAMOND_SIZE_HOVER = 14;
const COVER_W = 20;
const COVER_H = 28;
const EDITION_DOT_SIZE = 5;

export const MARKER_LANE_HEIGHT = 80;

// ── Helper ───────────────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "\u2026" : s;
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface WorkTimelineMarkerProps {
  work: WorkTimelineItem;
  /** Screen-space X of the work's originalYear */
  x: number;
  /** Screen-space Y (lane centre) */
  y: number;
  /** Current timeline scale (from useTimelineTransform) */
  scale: number;
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
  isHovered,
  onHover,
  scaledPixelsPerYear,
}: WorkTimelineMarkerProps) {
  const router = useRouter();
  const [imgError, setImgError] = useState(false);

  const showCover = scale > 0.3;
  const showAuthor = scale > 0.5;
  const showTitle = scale > 0.8;
  const showEditions = scale > 0.8;

  const diamondSize = isHovered ? DIAMOND_SIZE_HOVER : DIAMOND_SIZE_BASE;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      router.push(`/library/${work.slug}`);
    },
    [router, work.slug],
  );

  // The marker is anchored so the diamond centre is at (x, y).
  // The container is 80px wide, centred on x.
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
  const diamondCY = MARKER_LANE_HEIGHT / 2;

  const diamondStyle: CSSProperties = {
    position: "absolute",
    left: diamondCX - diamondSize / 2,
    top: diamondCY - diamondSize / 2,
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

  // Cover sits above the diamond
  const coverTop = diamondCY - diamondSize / 2 - 4 - COVER_H;
  const coverLeft = diamondCX - COVER_W / 2;

  const coverStyle: CSSProperties = {
    position: "absolute",
    left: coverLeft,
    top: coverTop,
    width: COVER_W,
    height: COVER_H,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "var(--color-bg-tertiary)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
    opacity: showCover ? 1 : 0,
    transition: "opacity 150ms ease",
    pointerEvents: "none",
  };

  // Title above the cover
  const titleTop = coverTop - 14;
  const titleStyle: CSSProperties = {
    position: "absolute",
    left: diamondCX - 36,
    width: 72,
    top: titleTop,
    fontSize: 10,
    fontFamily: "var(--font-serif)",
    color: "rgba(193,198,196,0.7)",
    textAlign: "center",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    opacity: showTitle ? 1 : 0,
    transition: "opacity 150ms ease",
    pointerEvents: "none",
  };

  // Author below the diamond
  const authorStyle: CSSProperties = {
    position: "absolute",
    left: diamondCX - 36,
    width: 72,
    top: diamondCY + diamondSize / 2 + 5,
    fontSize: 9,
    fontFamily: "var(--font-sans)",
    color: "rgba(74,79,77,0.8)",
    textAlign: "center",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    opacity: showAuthor ? 1 : 0,
    transition: "opacity 150ms ease",
    pointerEvents: "none",
  };

  const editionLineY = diamondCY;

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
        <span style={titleStyle}>{truncate(work.title, 14)}</span>
      )}

      {/* Book cover */}
      {showCover && (
        <div style={coverStyle}>
          {work.coverUrl && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={work.coverUrl}
              alt={work.title}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 10,
                  color: "var(--color-fg-muted)",
                  opacity: 0.5,
                }}
              >
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
              y1={editionLineY}
              x2={(() => {
                const maxYr = work.editions.reduce<number>((max, e) => {
                  const yr = e.publicationYear ?? work.originalYear;
                  return yr > max ? yr : max;
                }, work.originalYear);
                return (maxYr - work.originalYear) * scaledPixelsPerYear + EDITION_DOT_SIZE / 2;
              })()}
              y2={editionLineY}
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
                cy={editionLineY}
                r={EDITION_DOT_SIZE / 2}
                fill="rgba(88,110,117,0.5)"
              />
            );
          })}
        </svg>
      )}

      {/* Author */}
      {showAuthor && (
        <span style={authorStyle}>{truncate(work.authorName, 18)}</span>
      )}
    </div>
  );
}
