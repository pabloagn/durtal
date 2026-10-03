"use client";

import { useState, useCallback, useMemo } from "react";
import { Star } from "lucide-react";
import { TimelineCanvas, useTimelineContext } from "./timeline-canvas";
import { TimelineTooltip } from "./timeline-tooltip";
import {
  WorkTimelineMarker,
  LABEL_ROOM,
  MARKER_LANE_HEIGHT,
  labelWidth,
} from "./work-timeline-marker";
import { Badge } from "@/components/ui/badge";
import type { WorkTimelineItem } from "@/lib/actions/work-timeline";
import { STATUS_CONFIG } from "@/lib/constants/catalogue";
import type { CatalogueStatus } from "@/lib/types";
import { mediaImageStyle } from "@/lib/utils/media-style";

// ── Constants ────────────────────────────────────────────────────────────────

const PIXELS_PER_YEAR = 20;
const LANE_GAP = 8;
const TOTAL_LANE_H = MARKER_LANE_HEIGHT + LANE_GAP;

// ── Lane-packing algorithm ───────────────────────────────────────────────────

function packIntoLanes(
  works: WorkTimelineItem[],
  pixelsPerYear: number,
): Map<string, number> {
  const sorted = [...works].sort((a, b) => a.originalYear - b.originalYear);
  const laneEnds: number[] = [];
  const assignments = new Map<string, number>();

  // At scale 1, works in one lane are at least LABEL_ROOM apart, so their
  // labels fit side by side
  for (const work of sorted) {
    const workLeft = work.originalYear * pixelsPerYear - LABEL_ROOM / 2;
    const editionRights = work.editions.map(
      (e) => (e.publicationYear ?? work.originalYear) * pixelsPerYear + 10,
    );
    const workRight = Math.max(
      work.originalYear * pixelsPerYear + LABEL_ROOM / 2,
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

/**
 * For each work, the distance at scale 1 to the nearest work in its lane
 * (Infinity when it is alone). Its labels get `labelWidth(distance × scale)`.
 */
function laneGaps(
  works: WorkTimelineItem[],
  lanes: Map<string, number>,
  pixelsPerYear: number,
): Map<string, number> {
  const byLane = new Map<number, WorkTimelineItem[]>();
  for (const work of works) {
    const lane = lanes.get(work.id) ?? 0;
    byLane.set(lane, [...(byLane.get(lane) ?? []), work]);
  }
  const gaps = new Map<string, number>();
  for (const row of byLane.values()) {
    row.sort((a, b) => a.originalYear - b.originalYear);
    row.forEach((work, i) => {
      const prev = row[i - 1];
      const next = row[i + 1];
      gaps.set(
        work.id,
        Math.min(
          prev ? (work.originalYear - prev.originalYear) * pixelsPerYear : Infinity,
          next ? (next.originalYear - work.originalYear) * pixelsPerYear : Infinity,
        ),
      );
    });
  }
  return gaps;
}

// ── Catalogue status ─────────────────────────────────────────────────────────

/** The same label and color as the status everywhere else in the app */
function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as CatalogueStatus];
  return (
    <Badge variant={config?.variant ?? "muted"} className="self-start">
      {config?.label ?? status.replace("_", " ")}
    </Badge>
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
          <span className="select-none font-serif text-lg leading-none text-fg-secondary">
            {work.title[0]}
          </span>
        )}
      </div>

      {/* Meta */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        {/* Title */}
        <span className="line-clamp-2 font-serif text-xs leading-snug text-fg-primary">
          {work.title}
        </span>

        {/* Author */}
        {work.authorName && (
          <span className="font-sans text-micro text-fg-secondary">
            {work.authorName}
          </span>
        )}

        {/* Year */}
        <span className="font-mono text-micro tracking-wide text-fg-secondary">
          {work.originalYear}
        </span>

        {/* Rating */}
        {work.rating != null && <RatingStars rating={work.rating} />}

        {/* Status */}
        <StatusBadge status={work.catalogueStatus} />

        {/* Editions */}
        {editionsText && (
          <span className="mt-0.5 font-sans text-micro leading-normal text-fg-secondary">
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
  gaps: Map<string, number>;
  totalLanes: number;
  minYear: number;
  hoveredId: string | null;
  onHover: (id: string | null, clientX?: number, clientY?: number) => void;
}

function InnerContent({
  works,
  laneAssignments,
  gaps,
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
            labelW={labelWidth((gaps.get(work.id) ?? Infinity) * scale)}
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

  const gaps = useMemo(
    () => laneGaps(works, laneAssignments, PIXELS_PER_YEAR),
    [works, laneAssignments],
  );

  // All lanes, with 8px above (each lane ends with its 8px gap)
  const rowsHeight = totalLanes * TOTAL_LANE_H + 8;

  if (works.length === 0) {
    return (
      <div
        className="font-sans text-xs text-fg-secondary"
        style={{
          height: 400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        No works with publication years to display.
      </div>
    );
  }

  return (
    <>
      {/* The canvas fills its parent and scrolls through the lanes */}
      <TimelineCanvas
        minYear={minYear}
        maxYear={maxYear}
        pixelsPerYear={PIXELS_PER_YEAR}
        contentHeight={rowsHeight}
        className="h-full w-full"
      >
        <InnerContent
          works={works}
          laneAssignments={laneAssignments}
          gaps={gaps}
          totalLanes={totalLanes}
          minYear={minYear}
          hoveredId={hoveredId}
          onHover={handleHover}
        />
      </TimelineCanvas>

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
