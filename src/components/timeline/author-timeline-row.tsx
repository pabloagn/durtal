"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { AuthorTimelineItem } from "@/lib/actions/author-timeline";

// ── Constants ────────────────────────────────────────────────────────────────

export const ROW_HEIGHT = 30;
const BAR_HEIGHT = 24;
const PORTRAIT_SIZE = 20;
const LABEL_MIN_WIDTH = 80; // min bar pixel-width before we show the author name

// ── CSS keyframes injected once ──────────────────────────────────────────────

let _pulseInjected = false;
function injectPulseKeyframes() {
  if (typeof document === "undefined" || _pulseInjected) return;
  _pulseInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes author-alive-pulse {
      0%, 100% { opacity: 0.55; }
      50%       { opacity: 0.85; }
    }
  `;
  document.head.appendChild(style);
}

// ── Portrait ─────────────────────────────────────────────────────────────────

function Portrait({
  author,
  size,
}: {
  author: AuthorTimelineItem;
  size: number;
}) {
  const hasCrop =
    author.posterCrop &&
    (author.posterCrop.x !== 50 ||
      author.posterCrop.y !== 50 ||
      author.posterCrop.zoom !== 100);

  const containerStyle: CSSProperties = {
    flexShrink: 0,
    width: size,
    height: size,
    borderRadius: 2,
    overflow: "hidden",
    border: "1px solid rgba(193,198,196,0.10)",
    backgroundColor: "var(--color-bg-tertiary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  if (author.posterUrl) {
    const imgStyle: CSSProperties = hasCrop
      ? {
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: `${author.posterCrop!.x}% ${author.posterCrop!.y}%`,
          transform: `scale(${author.posterCrop!.zoom / 100})`,
          transformOrigin: `${author.posterCrop!.x}% ${author.posterCrop!.y}%`,
        }
      : { width: "100%", height: "100%", objectFit: "cover" };

    return (
      <div style={containerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={author.posterUrl} alt={author.name} style={imgStyle} />
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: size * 0.45,
          color: "var(--color-fg-muted)",
          userSelect: "none",
        }}
      >
        {author.name[0]}
      </span>
    </div>
  );
}

// ── Main row component ────────────────────────────────────────────────────────

export interface AuthorTimelineRowProps {
  author: AuthorTimelineItem;
  /** Screen-space left edge of the bar */
  startX: number;
  /** Screen-space right edge of the bar */
  endX: number;
  /** Top offset in the scroll container (absolute pixels) */
  y: number;
  isHovered: boolean;
  onHover: (id: string | null, clientX?: number, clientY?: number) => void;
  onClick: (slug: string) => void;
}

export function AuthorTimelineRow({
  author,
  startX,
  endX,
  y,
  isHovered,
  onHover,
  onClick,
}: AuthorTimelineRowProps) {
  // Inject pulse keyframes client-side
  injectPulseKeyframes();

  const isAlive = author.deathYear === null;
  const barWidth = Math.max(0, endX - startX);

  // Horizontal bar
  const barStyle: CSSProperties = {
    position: "absolute",
    left: startX,
    top: y + (ROW_HEIGHT - BAR_HEIGHT) / 2,
    width: barWidth,
    height: BAR_HEIGHT,
    borderRadius: 2,
    overflow: "hidden",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    transition: "box-shadow 120ms ease",
    boxShadow: isHovered
      ? "0 0 0 1px rgba(125,61,82,0.6), 0 0 12px -2px rgba(125,61,82,0.5)"
      : "none",
    zIndex: isHovered ? 5 : 1,
  };

  // Inner gradient fill — slightly brighter on hover
  const fillStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: isHovered
      ? "linear-gradient(90deg, rgba(70,41,65,0.85) 0%, rgba(142,64,87,0.75) 100%)"
      : "linear-gradient(90deg, rgba(32,19,30,0.80) 0%, rgba(125,61,82,0.55) 100%)",
    transition: "background 120ms ease",
  };

  // For living authors, fade the right edge to transparent + animate opacity
  const aliveEdgeStyle: CSSProperties = isAlive
    ? {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: Math.min(barWidth * 0.25, 40),
        background:
          "linear-gradient(90deg, transparent 0%, rgba(3,5,7,0.70) 100%)",
        animation: "author-alive-pulse 2s ease-in-out infinite",
        pointerEvents: "none",
      }
    : {};

  const showLabel = barWidth >= LABEL_MIN_WIDTH;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${author.name}, ${author.birthYear}–${author.deathYear ?? "present"}`}
      style={barStyle}
      onPointerEnter={(e) => onHover(author.id, e.clientX, e.clientY)}
      onPointerLeave={() => onHover(null)}
      onPointerMove={(e) => {
        if (isHovered) onHover(author.id, e.clientX, e.clientY);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(author.slug);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(author.slug);
        }
      }}
    >
      {/* Background fill */}
      <div style={fillStyle} />

      {/* Portrait — pinned to the left edge, above the fill */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 2,
          paddingRight: 4,
          height: "100%",
          flexShrink: 0,
          pointerEvents: "none",
        }}
      >
        <Portrait author={author} size={PORTRAIT_SIZE} />

        {showLabel && (
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-sans)",
              color: "var(--color-fg-primary)",
              opacity: 0.8,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: barWidth - PORTRAIT_SIZE - 32,
              lineHeight: 1,
              userSelect: "none",
            }}
          >
            {author.name}
          </span>
        )}
      </div>

      {/* Birth year — left outer edge label (only when bar is visible) */}
      {barWidth > 10 && (
        <span
          style={{
            position: "absolute",
            left: 2,
            bottom: -14,
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--color-fg-muted)",
            opacity: 0.6,
            pointerEvents: "none",
            zIndex: 3,
            userSelect: "none",
          }}
        >
          {author.birthYear}
        </span>
      )}

      {/* Death year — right outer edge label */}
      {!isAlive && author.deathYear && barWidth > 30 && (
        <span
          style={{
            position: "absolute",
            right: 2,
            bottom: -14,
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--color-fg-muted)",
            opacity: 0.6,
            pointerEvents: "none",
            zIndex: 3,
            userSelect: "none",
          }}
        >
          {author.deathYear}
        </span>
      )}

      {/* Living author edge fade */}
      {isAlive && <div style={aliveEdgeStyle} />}
    </div>
  );
}
