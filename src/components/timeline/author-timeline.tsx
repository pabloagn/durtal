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
import { monogramTint } from "@/components/shared/no-photo";
import { mediaImageStyle } from "@/lib/utils/media-style";
import { displayYear } from "@/lib/utils/years";

// ── Constants ────────────────────────────────────────────────────────────────

const PIXELS_PER_YEAR = 20;
const CURRENT_YEAR = new Date().getFullYear();

// ── Tooltip content ──────────────────────────────────────────────────────────

function AuthorTooltipContent({ author }: { author: AuthorTimelineItem }) {

  const lifeDates = author.deathYear
    ? `${displayYear(author.birthYear)} — ${displayYear(author.deathYear)}`
    : `${displayYear(author.birthYear)} — present`;

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        minWidth: 180,
      }}
    >
      {/* Portrait 48×48. With no photo, the letter is fg-primary: fg-secondary
          is under 4.5:1 on four of the six Monogram tints. */}
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
          ...(author.posterUrl ? {} : monogramTint(author.name)),
        }}
      >
        {author.posterUrl ? (
          <img
            src={author.posterUrl}
            alt={author.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              ...mediaImageStyle(author.posterCrop),
            }}
          />
        ) : (
          <span className="select-none font-serif text-lg leading-none text-fg-primary">
            {author.name[0]}
          </span>
        )}
      </div>

      {/* Text block */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span className="font-serif text-xs leading-tight text-fg-primary">
          {author.name}
        </span>
        {author.nationality && (
          <span className="font-sans text-micro text-fg-secondary">
            {author.nationality}
          </span>
        )}
        <span className="font-mono text-micro tracking-wide text-fg-secondary">
          {lifeDates}
        </span>
        {author.worksCount > 0 && (
          <span className="font-sans text-micro text-fg-secondary">
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
      router.push(`/people/${slug}`);
    },
    [router],
  );

  const hoveredAuthor = hoveredId
    ? sorted.find((a) => a.id === hoveredId) ?? null
    : null;

  // The rows, with 8px above and below
  const rowsHeight = sorted.length * ROW_HEIGHT + 16;

  return (
    <>
      {/* The canvas fills its parent and scrolls through the rows; it also
          handles horizontal pan and zoom. */}
      <TimelineCanvas
        minYear={minYear}
        maxYear={maxYear}
        pixelsPerYear={PIXELS_PER_YEAR}
        contentHeight={rowsHeight}
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
