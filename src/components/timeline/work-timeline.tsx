"use client";

import {
  useState,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import { Star } from "lucide-react";
import { TimelineCanvas, useTimelineContext } from "./timeline-canvas";
import { TimelineTooltip } from "./timeline-tooltip";
import { WorkTimelineMarker, MARKER_LANE_HEIGHT } from "./work-timeline-marker";
import type { WorkTimelineItem } from "@/lib/actions/work-timeline";

// ── Constants ────────────────────────────────────────────────────────────────

const PIXELS_PER_YEAR = 20;
const LANE_GAP = 8;
const TOTAL_LANE_H = MARKER_LANE_HEIGHT + LANE_GAP;
/** Space at the bottom for the axis label row + minimap strip */
const BOTTOM_CHROME_HEIGHT = 68;

// ── Lane-packing algorithm ───────────────────────────────────────────────────

function packIntoLanes(
  works: WorkTimelineItem[],
  pixelsPerYear: number,
): Map<string, number> {
  const sorted = [...works].sort((a, b) => a.originalYear - b.originalYear);
  const laneEnds: number[] = [];
  const assignments = new Map<string, number>();

  for (const work of sorted) {
    const workLeft = work.originalYear * pixelsPerYear - 30;
    const editionRights = work.editions.map(
      (e) => (e.publicationYear ?? work.originalYear) * pixelsPerYear + 10,
    );
    const workRight = Math.max(
      work.originalYear * pixelsPerYear + 30,
      ...editionRights,
    );

    let lane = laneEnds.findIndex((end) => end < workLeft);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }

    laneEnds[lane] = workRight;
    assignments.set(work.id, lane);
  }

  return assignments;
}

// ── Catalogue status pill ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  accessioned: "var(--color-accent-sage)",
  wanted: "var(--color-accent-rose)",
  shortlisted: "var(--color-accent-gold)",
  tracked: "var(--color-accent-slate)",
  on_order: "var(--color-accent-blue)",
  deaccessioned: "var(--color-fg-muted)",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "var(--color-fg-muted)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 5px",
        borderRadius: 2,
        fontSize: 9,
        fontFamily: "var(--font-sans)",
        backgroundColor: `${color}22`,
        color,
        border: `1px solid ${color}44`,
        textTransform: "capitalize",
        letterSpacing: "0.04em",
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

// ── Stars ────────────────────────────────────────────────────────────────────

function RatingStars({ rating }: { rating: number }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={10}
          strokeWidth={1.5}
          fill={i < rating ? "var(--color-accent-gold)" : "none"}
          color={
            i < rating ? "var(--color-accent-gold)" : "var(--color-fg-muted)"
          }
        />
      ))}
    </div>
  );
}

// ── Tooltip content ──────────────────────────────────────────────────────────

function WorkTooltipContent({ work }: { work: WorkTimelineItem }) {
  const [imgError, setImgError] = useState(false);

  const editionsText = work.editions
    .filter((e) => e.publicationYear != null)
    .slice(0, 4)
    .map((e, i) => {
      const ordinal = ["1st", "2nd", "3rd"][i] ?? `${i + 1}th`;
      return `${ordinal} ed. ${e.publicationYear}${e.publisher ? ` (${e.publisher})` : ""}`;
    })
    .join(", ");

  return (
    <div style={{ display: "flex", gap: 10, minWidth: 220, maxWidth: 280 }}>
      {/* Cover */}
      <div
        style={{
          flexShrink: 0,
          width: 60,
          height: 90,
          borderRadius: 2,
          overflow: "hidden",
          backgroundColor: "var(--color-bg-tertiary)",
          border: "1px solid rgba(193,198,196,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {work.coverUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={work.coverUrl}
            alt={work.title}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            onError={() => setImgError(true)}
          />
        ) : (
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 20,
              color: "var(--color-fg-muted)",
              opacity: 0.4,
              userSelect: "none",
            }}
          >
            {work.title[0]}
          </span>
        )}
      </div>

      {/* Meta */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        {/* Title */}
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 13,
            color: "var(--color-fg-primary)",
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {work.title}
        </span>

        {/* Author */}
        {work.authorName && (
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-sans)",
              color: "var(--color-fg-secondary)",
            }}
          >
            {work.authorName}
          </span>
        )}

        {/* Year */}
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--color-fg-muted)",
            letterSpacing: "0.02em",
          }}
        >
          {work.originalYear}
        </span>

        {/* Rating */}
        {work.rating != null && <RatingStars rating={work.rating} />}

        {/* Status */}
        <StatusBadge status={work.catalogueStatus} />

        {/* Editions */}
        {editionsText && (
          <span
            style={{
              fontSize: 9,
              fontFamily: "var(--font-sans)",
              color: "var(--color-fg-muted)",
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            {editionsText}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Inner canvas content (accesses TimelineContext) ───────────────────────────

interface InnerContentProps {
  works: WorkTimelineItem[];
  laneAssignments: Map<string, number>;
  totalLanes: number;
  minYear: number;
  hoveredId: string | null;
  onHover: (id: string | null, clientX?: number, clientY?: number) => void;
}

function InnerContent({
  works,
  laneAssignments,
  totalLanes,
  minYear,
  hoveredId,
  onHover,
}: InnerContentProps) {
  const { transform, pixelsPerYear, containerWidth } = useTimelineContext();
  const { offsetX, scale } = transform;

  // Cull works outside the visible viewport with generous margin
  const visibleWorks = useMemo(() => {
    const margin = 120;
    return works.filter((work) => {
      const worldX = (work.originalYear - minYear) * pixelsPerYear;
      const screenX = worldX * scale + offsetX;
      return screenX >= -margin && screenX <= containerWidth + margin;
    });
  }, [works, minYear, pixelsPerYear, scale, offsetX, containerWidth]);

  const totalHeight = totalLanes * TOTAL_LANE_H;

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
      {visibleWorks.map((work) => {
        const lane = laneAssignments.get(work.id) ?? 0;
        const worldX = (work.originalYear - minYear) * pixelsPerYear;
        const screenX = worldX * scale + offsetX;
        // Y: lane centre
        const screenY = lane * TOTAL_LANE_H + MARKER_LANE_HEIGHT / 2;

        return (
          <WorkTimelineMarker
            key={work.id}
            work={work}
            x={screenX}
            y={screenY}
            scale={scale}
            isHovered={hoveredId === work.id}
            onHover={onHover}
            scaledPixelsPerYear={pixelsPerYear * scale}
          />
        );
      })}
    </div>
  );
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export interface WorkTimelineProps {
  works: WorkTimelineItem[];
}

export function WorkTimeline({ works }: WorkTimelineProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const handleHover = useCallback(
    (id: string | null, clientX?: number, clientY?: number) => {
      setHoveredId(id);
      if (id && clientX != null && clientY != null) {
        setTooltipPos({ x: clientX, y: clientY });
      }
    },
    [],
  );

  const hoveredWork = hoveredId
    ? works.find((w) => w.id === hoveredId) ?? null
    : null;

  // Year range with padding
  const { minYear, maxYear } = useMemo(() => {
    if (works.length === 0) return { minYear: 1800, maxYear: 2030 };
    let mn = Infinity;
    let mx = -Infinity;
    for (const w of works) {
      if (w.originalYear < mn) mn = w.originalYear;
      if (w.originalYear > mx) mx = w.originalYear;
      for (const e of w.editions) {
        const yr = e.publicationYear ?? w.originalYear;
        if (yr < mn) mn = yr;
        if (yr > mx) mx = yr;
      }
    }
    return { minYear: mn - 10, maxYear: mx + 10 };
  }, [works]);

  // Lane packing at base scale (scale === 1)
  const laneAssignments = useMemo(
    () => packIntoLanes(works, PIXELS_PER_YEAR),
    [works],
  );

  const totalLanes = useMemo(() => {
    if (laneAssignments.size === 0) return 1;
    return Math.max(...Array.from(laneAssignments.values())) + 1;
  }, [laneAssignments]);

  // Canvas height: all lanes plus bottom chrome (axis + minimap)
  const rowsHeight = totalLanes * TOTAL_LANE_H + 8; // 8 top padding
  const canvasHeight = rowsHeight + BOTTOM_CHROME_HEIGHT;

  const outerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    overflowY: "auto",
    overflowX: "hidden",
  };

  if (works.length === 0) {
    return (
      <div
        style={{
          height: 400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-fg-muted)",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
        }}
      >
        No works with publication years to display.
      </div>
    );
  }

  return (
    <>
      <div style={outerStyle}>
        <div style={{ width: "100%", height: canvasHeight }}>
          <TimelineCanvas
            minYear={minYear}
            maxYear={maxYear}
            pixelsPerYear={PIXELS_PER_YEAR}
            className="h-full w-full"
          >
            <InnerContent
              works={works}
              laneAssignments={laneAssignments}
              totalLanes={totalLanes}
              minYear={minYear}
              hoveredId={hoveredId}
              onHover={handleHover}
            />
          </TimelineCanvas>
        </div>
      </div>

      {/* Fixed-position tooltip */}
      <TimelineTooltip
        x={tooltipPos.x}
        y={tooltipPos.y}
        visible={!!hoveredWork}
      >
        {hoveredWork && <WorkTooltipContent work={hoveredWork} />}
      </TimelineTooltip>
    </>
  );
}
