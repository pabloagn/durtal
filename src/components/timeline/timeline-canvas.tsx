"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  createContext,
  useContext,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  useTimelineTransform,
  type TimelineTransform,
  type UseTimelineTransformReturn,
} from "./use-timeline-transform";
import { TimelineAxis, AXIS_HEADER_HEIGHT } from "./timeline-axis";
import { TimelineZoomControls } from "./timeline-zoom-controls";
import { TimelineMinimap } from "./timeline-minimap";
import { TIMELINE_ERAS } from "./timeline-eras";

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_SCALE = 0.05;
const MAX_SCALE = 15;

// ── Context ─────────────────────────────────────────────────────────────────

export interface TimelineCanvasContext {
  transform: TimelineTransform;
  minYear: number;
  maxYear: number;
  pixelsPerYear: number;
  containerWidth: number;
  containerHeight: number;
  zoomIn: UseTimelineTransformReturn["zoomIn"];
  zoomOut: UseTimelineTransformReturn["zoomOut"];
  resetView: UseTimelineTransformReturn["resetView"];
  panTo: UseTimelineTransformReturn["panTo"];
}

const TimelineContext = createContext<TimelineCanvasContext | null>(null);

export function useTimelineContext(): TimelineCanvasContext {
  const ctx = useContext(TimelineContext);
  if (!ctx) {
    throw new Error("useTimelineContext must be used inside <TimelineCanvas>");
  }
  return ctx;
}

// ── Era background regions ───────────────────────────────────────────────────

interface EraFillsProps {
  minYear: number;
  pixelsPerYear: number;
  transform: TimelineTransform;
  contentHeight: number;
}

function EraFills({
  minYear,
  pixelsPerYear,
  transform,
  contentHeight,
}: EraFillsProps) {
  return (
    <>
      {TIMELINE_ERAS.map((era) => {
        const worldStart = (era.startYear - minYear) * pixelsPerYear;
        const worldEnd = (era.endYear - minYear) * pixelsPerYear;
        const screenStart = worldStart * transform.scale + transform.offsetX;
        const screenWidth = (worldEnd - worldStart) * transform.scale;

        return (
          <div
            key={era.label}
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: screenStart,
              width: Math.max(0, screenWidth),
              height: contentHeight,
              backgroundColor: era.color,
              opacity: 0.04,
              pointerEvents: "none",
            }}
          />
        );
      })}
    </>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface TimelineCanvasProps {
  children?: ReactNode;
  minYear: number;
  maxYear: number;
  pixelsPerYear?: number;
  className?: string;
}

export function TimelineCanvas({
  children,
  minYear,
  maxYear,
  pixelsPerYear = 20,
  className = "",
}: TimelineCanvasProps) {
  const {
    transform,
    containerRef,
    handlers,
    zoomIn,
    zoomOut,
    resetView,
    panTo,
    setTransform,
  } = useTimelineTransform();

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // ── ResizeObserver ────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });
    ro.observe(el);

    // Set initial size
    setContainerSize({ width: el.clientWidth, height: el.clientHeight });

    return () => ro.disconnect();
  }, [containerRef]);

  // ── Live refs for native wheel handler ────────────────────────────────────
  // We need the latest transform and setTransform without stale closures.
  const transformRef = useRef<TimelineTransform>(transform);
  transformRef.current = transform;

  const setTransformRef = useRef(setTransform);
  setTransformRef.current = setTransform;

  // rAF batching for native wheel events
  const pendingWheelTransform = useRef<TimelineTransform | null>(null);
  const wheelRafId = useRef<number | null>(null);

  const scheduleWheelUpdate = useCallback((next: TimelineTransform) => {
    pendingWheelTransform.current = next;
    if (wheelRafId.current === null) {
      wheelRafId.current = requestAnimationFrame(() => {
        if (pendingWheelTransform.current) {
          setTransformRef.current(pendingWheelTransform.current);
          pendingWheelTransform.current = null;
        }
        wheelRafId.current = null;
      });
    }
  }, []);

  // ── Native wheel listener (non-passive so preventDefault works) ───────────
  // React 17+ attaches synthetic wheel events as passive by default which
  // prevents e.preventDefault() from stopping page scroll. We attach a
  // native non-passive listener instead and skip the synthetic onWheel.

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      const current = transformRef.current;

      // Ctrl+wheel → zoom centered on cursor position
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;

        const zoomDelta = -e.deltaY * 0.001;
        const zoomMultiplier = Math.exp(zoomDelta * 0.8);
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * zoomMultiplier));

        const worldX = (cursorX - current.offsetX) / current.scale;
        const newOffsetX = cursorX - worldX * newScale;

        scheduleWheelUpdate({ ...current, scale: newScale, offsetX: newOffsetX });
        return;
      }

      // Shift+wheel or horizontal scroll → pan horizontally
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        scheduleWheelUpdate({ ...current, offsetX: current.offsetX - delta });
        return;
      }

      // Plain vertical scroll → let the browser scroll the outer container vertically
      // (do NOT prevent default — this allows native vertical scrolling)
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      if (wheelRafId.current !== null) {
        cancelAnimationFrame(wheelRafId.current);
        wheelRafId.current = null;
      }
    };
  }, [containerRef, scheduleWheelUpdate]);

  // Strip onWheel from the React synthetic handlers since we use a native listener
  const { onWheel: _ignoredOnWheel, ...restHandlers } = handlers;
  void _ignoredOnWheel;

  // ── Viewport year range for minimap ──────────────────────────────────────

  const screenToYear = useCallback(
    (screenX: number): number => {
      const worldX = (screenX - transform.offsetX) / transform.scale;
      return worldX / pixelsPerYear + minYear;
    },
    [transform, pixelsPerYear, minYear],
  );

  const viewportMinYear = screenToYear(0);
  const viewportMaxYear = screenToYear(containerSize.width);

  // ── Minimap navigation ────────────────────────────────────────────────────

  const handleMinimapNavigate = useCallback(
    (centerYear: number) => {
      const viewportHalfWidth = containerSize.width / 2;
      const worldCenterX = (centerYear - minYear) * pixelsPerYear;
      const newOffsetX = viewportHalfWidth - worldCenterX * transform.scale;
      panTo(newOffsetX);
    },
    [containerSize.width, minYear, pixelsPerYear, transform.scale, panTo],
  );

  // ── Context value ─────────────────────────────────────────────────────────

  const contentHeight = Math.max(0, containerSize.height - AXIS_HEADER_HEIGHT);

  const contextValue: TimelineCanvasContext = {
    transform,
    minYear,
    maxYear,
    pixelsPerYear,
    containerWidth: containerSize.width,
    containerHeight: contentHeight,
    zoomIn,
    zoomOut,
    resetView,
    panTo,
  };

  // ── Inline styles ─────────────────────────────────────────────────────────

  const containerStyle: CSSProperties = {
    position: "relative",
    overflowX: "hidden",
    overflowY: "auto",
    cursor: "grab",
    outline: "none",
    willChange: "transform",
    userSelect: "none",
    WebkitUserSelect: "none",
  };

  // Content area sits below the axis header
  const contentAreaStyle: CSSProperties = {
    position: "relative",
    left: 0,
    right: 0,
    transform: "translate3d(0, 0, 0)",
    willChange: "transform",
  };

  return (
    <TimelineContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        style={containerStyle}
        className={`bg-bg-primary select-none ${className}`}
        tabIndex={0}
        role="application"
        aria-label="Timeline canvas"
        {...restHandlers}
      >
        {/* Sticky axis header — sticks to top on vertical scroll */}
        {containerSize.width > 0 && (
          <TimelineAxis
            minYear={minYear}
            maxYear={maxYear}
            transform={transform}
            pixelsPerYear={pixelsPerYear}
            containerWidth={containerSize.width}
          />
        )}

        {/* Content area below axis header */}
        <div style={contentAreaStyle}>
          {/* Era background fills */}
          {contentHeight > 0 && (
            <EraFills
              minYear={minYear}
              pixelsPerYear={pixelsPerYear}
              transform={transform}
              contentHeight={contentHeight}
            />
          )}

          {/* Main content layer */}
          {children}
        </div>

        {/* Zoom controls — bottom-right corner, above minimap */}
        <div
          style={{
            position: "sticky",
            bottom: 44,
            float: "right",
            marginRight: 12,
            zIndex: 30,
          }}
        >
          <TimelineZoomControls
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onReset={resetView}
          />
        </div>

        {/* Minimap — pinned to the bottom */}
        <div
          style={{
            position: "sticky",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 30,
          }}
        >
          <TimelineMinimap
            minYear={minYear}
            maxYear={maxYear}
            viewportMinYear={viewportMinYear}
            viewportMaxYear={viewportMaxYear}
            onNavigate={handleMinimapNavigate}
          />
        </div>
      </div>
    </TimelineContext.Provider>
  );
}
