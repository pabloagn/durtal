"use client";

import type { CSSProperties } from "react";
import type { AuthorTimelineItem } from "@/lib/actions/author-timeline";
import { monogramTint } from "@/components/shared/no-photo";
import { mediaImageStyle } from "@/lib/utils/media-style";
import { displayYear } from "@/lib/utils/years";

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
    const imgStyle: CSSProperties = {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      ...mediaImageStyle(author.posterCrop),
    };

    return (
      <div style={containerStyle}>
        <img src={author.posterUrl} alt={author.name} style={imgStyle} />
      </div>
    );
  }

  // No photo: the initial on the author's Monogram tint, as on their card. At
  // 12px it is fg-primary: fg-secondary is under 4.5:1 on four of the tints.
  return (
    <div style={{ ...containerStyle, ...monogramTint(author.name) }}>
      <span className="select-none font-serif text-micro leading-none text-fg-primary">
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
    // The rows layer ignores the pointer, so the canvas can pan; a bar takes it
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
    transition: "box-shadow 120ms ease",
    boxShadow: isHovered
      ? "0 0 0 1px var(--color-accent-primary)"
      : "none",
    zIndex: isHovered ? 5 : 1,
  };

  // Inner gradient fill — slightly brighter on hover
  const fillStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: isHovered
      ? "linear-gradient(90deg, var(--color-selection-bg) 0%, var(--color-accent-underlay) 100%)"
      : "linear-gradient(90deg, var(--color-bg-secondary) 0%, var(--color-selection-bg) 100%)",
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
          "linear-gradient(90deg, transparent 0%, var(--color-scrim) 100%)",
        animation: "author-alive-pulse 2s ease-in-out infinite",
        pointerEvents: "none",
      }
    : {};

  const showLabel = barWidth >= LABEL_MIN_WIDTH;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${author.name}, ${displayYear(author.birthYear)}–${author.deathYear ? displayYear(author.deathYear) : "present"}`}
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
            className="select-none truncate font-sans text-micro leading-4 text-fg-primary"
            style={{ maxWidth: barWidth - PORTRAIT_SIZE - 32 }}
          >
            {author.name}
          </span>
        )}
      </div>

      {/* Living author edge fade */}
      {isAlive && <div style={aliveEdgeStyle} />}
    </div>
  );
}
