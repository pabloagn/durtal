"use client";

import {
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import type { AuthorTimelineItem } from "@/lib/actions/author-timeline";
import { TimelineCanvas, useTimelineContext } from "./timeline-canvas";
import { TimelineTooltip } from "./timeline-tooltip";
import { AuthorTimelineRow, ROW_HEIGHT } from "./author-timeline-row";

// ── Constants ────────────────────────────────────────────────────────────────

const PIXELS_PER_YEAR = 20;
const CURRENT_YEAR = new Date().getFullYear();
/** Space at the bottom occupied by the axis label row + minimap strip */
const BOTTOM_CHROME_HEIGHT = 68;

// ── Tooltip content ──────────────────────────────────────────────────────────

function AuthorTooltipContent({ author }: { author: AuthorTimelineItem }) {
  const hasCrop =
    author.posterCrop &&
    (author.posterCrop.x !== 50 ||
      author.posterCrop.y !== 50 ||
      author.posterCrop.zoom !== 100);

  const lifeDates = author.deathYear
    ? `${author.birthYear} — ${author.deathYear}`
    : `${author.birthYear} — present`;

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        minWidth: 180,
      }}
    >
      {/* Portrait 48×48 */}
      <div
        style={{
          flexShrink: 0,
          width: 48,
          height: 48,
          borderRadius: 2,
          overflow: "hidden",
          border: "1px solid rgba(193,198,196,0.10)",
          backgroundColor: "var(--color-bg-tertiary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {author.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={author.posterUrl}
            alt={author.name}
            style={
              hasCrop
                ? {
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: `${author.posterCrop!.x}% ${author.posterCrop!.y}%`,
                    transform: `scale(${author.posterCrop!.zoom / 100})`,
                    transformOrigin: `${author.posterCrop!.x}% ${author.posterCrop!.y}%`,
                  }
                : { width: "100%", height: "100%", objectFit: "cover" }
            }
          />
        ) : (
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 22,
              color: "var(--color-fg-muted)",
              userSelect: "none",
            }}
          >
            {author.name[0]}
          </span>
        )}
      </div>

      {/* Text block */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 14,
            color: "var(--color-fg-primary)",
            lineHeight: 1.2,
          }}
        >
          {author.name}
        </span>
        {author.nationality && (
          <span
            style={{
              fontSize: 11,
              color: "var(--color-fg-secondary)",
              fontFamily: "var(--font-sans)",
            }}
          >
            {author.nationality}
          </span>
        )}
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--color-fg-muted)",
            letterSpacing: "0.02em",
          }}
        >
          {lifeDates}
        </span>
        {author.worksCount > 0 && (
          <span
            style={{
              fontSize: 10,
              color: "var(--color-fg-muted)",
              fontFamily: "var(--font-sans)",
              opacity: 0.8,
            }}
          >
            {author.worksCount} {author.worksCount === 1 ? "work" : "works"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Inner canvas content (accesses TimelineContext) ───────────────────────────

interface InnerContentProps {
  authors: AuthorTimelineItem[];
  minYear: number;
  hoveredId: string | null;
  onHover: (id: string | null, clientX?: number, clientY?: number) => void;
  onClickAuthor: (slug: string) => void;
}

function InnerContent({
  authors,
  minYear,
  hoveredId,
  onHover,
  onClickAuthor,
}: InnerContentProps) {
  const { transform, pixelsPerYear, containerWidth } = useTimelineContext();
  const { offsetX, scale } = transform;

  const visibleRows = useMemo(() => {
    return authors.map((author, idx) => {
      const worldStart = (author.birthYear - minYear) * pixelsPerYear;
      const worldEnd =
        ((author.deathYear ?? CURRENT_YEAR) - minYear) * pixelsPerYear;

      const screenStart = worldStart * scale + offsetX;
      const screenEnd = worldEnd * scale + offsetX;

      // Horizontal cull with generous margin for labels/portraits
      if (screenEnd < -200 || screenStart > containerWidth + 200) {
        return null;
      }

      return {
        author,
        startX: screenStart,
        endX: screenEnd,
        y: idx * ROW_HEIGHT,
      };
    });
  }, [authors, minYear, pixelsPerYear, scale, offsetX, containerWidth]);

  const totalHeight = authors.length * ROW_HEIGHT;

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        left: 0,
        width: "100%",
        height: totalHeight,
        pointerEvents: "none",
      }}
    >
      {visibleRows.map((row) => {
        if (!row) return null;
        return (
          <AuthorTimelineRow
            key={row.author.id}
            author={row.author}
            startX={row.startX}
            endX={row.endX}
            y={row.y}
            isHovered={hoveredId === row.author.id}
            onHover={onHover}
            onClick={onClickAuthor}
          />
        );
      })}
    </div>
  );
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export type TimelineSortKey = "name" | "lastName" | "birth" | "works" | "recent";

export interface AuthorTimelineProps {
  authors: AuthorTimelineItem[];
  sortBy?: TimelineSortKey;
  sortOrder?: "asc" | "desc";
}

export function AuthorTimeline({
  authors,
  sortBy = "birth",
  sortOrder = "asc",
}: AuthorTimelineProps) {
  const router = useRouter();

  // Sort authors based on the active sort key
  const sorted = useMemo(() => {
    const copy = [...authors];
    const dir = sortOrder === "desc" ? -1 : 1;
    switch (sortBy) {
      case "name":
        copy.sort((a, b) => dir * a.name.localeCompare(b.name));
        break;
      case "lastName": {
        const getLast = (n: string) => {
          const parts = n.split(" ");
          return parts[parts.length - 1];
        };
        copy.sort((a, b) => dir * getLast(a.name).localeCompare(getLast(b.name)));
        break;
      }
      case "works":
        copy.sort((a, b) => dir * (a.worksCount - b.worksCount));
        break;
      case "recent":
        // Most recently born first (desc by default)
        copy.sort((a, b) => dir * (a.birthYear - b.birthYear));
        break;
      case "birth":
      default:
        copy.sort((a, b) => dir * (a.birthYear - b.birthYear));
        break;
    }
    return copy;
  }, [authors, sortBy, sortOrder]);

  // Compute year range from data
  const { minYear, maxYear } = useMemo(() => {
    if (sorted.length === 0) {
      return { minYear: 1800, maxYear: CURRENT_YEAR };
    }
    const births = sorted.map((a) => a.birthYear);
    const ends = sorted.map((a) => a.deathYear ?? CURRENT_YEAR);
    return {
      minYear: Math.min(...births) - 10,
      maxYear: Math.max(...ends) + 10,
    };
  }, [sorted]);

  // Hover state with 3-second delay for tooltip
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHoverId = useRef<string | null>(null);

  const handleHover = useCallback(
    (id: string | null, clientX?: number, clientY?: number) => {
      if (id && clientX != null && clientY != null) {
        setTooltipPos({ x: clientX, y: clientY });
      }
      if (id === null) {
        // Mouse left — clear everything
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        pendingHoverId.current = null;
        setHoveredId(null);
        setTooltipVisible(false);
        return;
      }
      // Hovering over an author — highlight bar immediately, show tooltip after delay
      setHoveredId(id);
      if (pendingHoverId.current !== id) {
        // New author — reset timer
        pendingHoverId.current = id;
        setTooltipVisible(false);
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
          if (pendingHoverId.current === id) {
            setTooltipVisible(true);
          }
        }, 3000);
      }
    },
    [],
  );

  const handleClickAuthor = useCallback(
    (slug: string) => {
      router.push(`/authors/${slug}`);
    },
    [router],
  );

  const hoveredAuthor = hoveredId
    ? sorted.find((a) => a.id === hoveredId) ?? null
    : null;

  // The canvas must be tall enough to contain all author rows plus the
  // bottom chrome (axis + minimap).
  const rowsHeight = sorted.length * ROW_HEIGHT;
  const canvasHeight = rowsHeight + BOTTOM_CHROME_HEIGHT + 16; // 16px top padding

  return (
    <>
      {/* The canvas height grows with number of authors so vertical scroll
          on the canvas reveals all rows. The TimelineCanvas handles both
          vertical scrolling and horizontal pan/zoom. */}
      <div style={{ width: "100%", height: canvasHeight }}>
        <TimelineCanvas
          minYear={minYear}
          maxYear={maxYear}
          pixelsPerYear={PIXELS_PER_YEAR}
          className="h-full w-full"
        >
          <InnerContent
            authors={sorted}
            minYear={minYear}
            hoveredId={hoveredId}
            onHover={handleHover}
            onClickAuthor={handleClickAuthor}
          />
        </TimelineCanvas>
      </div>

      {/* Fixed-position tooltip — only appears after 3-second hover */}
      <TimelineTooltip
        x={tooltipPos.x}
        y={tooltipPos.y}
        visible={tooltipVisible && !!hoveredAuthor}
      >
        {hoveredAuthor && <AuthorTooltipContent author={hoveredAuthor} />}
      </TimelineTooltip>
    </>
  );
}
